import { spawn } from "node:child_process";

import { actions } from "../../../ai/config";
import { RUNNER_SOURCE } from "./runner";

/*
 * Running code a language model wrote.
 *
 * capabilities.ts carried this capability as `ready: false` for
 * a long time with one line of explanation — "Needs a sandbox.
 * Running model-written code anywhere else is not an option."
 * This is that sandbox, and the honest description of it is
 * four layers, none of which is sufficient alone.
 *
 *   PROCESS. A separate `node --permission` child. Node's
 *   permission model denies the filesystem, child processes,
 *   worker threads and native addons at the runtime level, so
 *   they fail even for code that has completely escaped
 *   everything above it. Measured on this platform rather than
 *   taken from the documentation: fs read, fs write,
 *   child_process and worker_threads all return
 *   ERR_ACCESS_DENIED.
 *
 *   REALM. A vm context whose globals are built inside itself,
 *   so the program has no require, no process, no fetch, and
 *   no host object to reach ours through. This layer is what
 *   takes away the NETWORK, and it has to, because — and this
 *   is the thing worth knowing before trusting the layer above
 *   — Node's permission model does not cover the network at
 *   all. There is no --allow-net. A --permission child with no
 *   grants whatsoever can still open a socket to anywhere and
 *   can still call fetch. Verified, twice, because the first
 *   result was surprising enough to doubt.
 *
 *   RESOURCES. A vm timeout for synchronous work, a wall clock
 *   outside the process for everything the vm timeout cannot
 *   see, a heap cap, and an output cap enforced as bytes
 *   arrive rather than after the child exits — a program that
 *   prints in a loop would otherwise fill this server's memory
 *   long before any timeout fired.
 *
 *   ENVIRONMENT. A stripped `env`. The permission model does
 *   NOT hide process.env, so a child that inherited this
 *   server's environment would be handing every provider key
 *   and the Supabase service role to anything that got out of
 *   the context. It inherits nothing.
 *
 * What this is not: a hypervisor. It is four cheap layers that
 * each have to fail before anything interesting happens, on a
 * runtime feature Node still calls experimental. A CPU
 * side-channel, a V8 bug, or a Node permission bypass all go
 * straight through it. For the workload — a student's agent
 * parsing some numbers — that is a sensible place to stop. For
 * anything running untrusted code at scale it is not, which is
 * why `SandboxRunner` below is an interface: a container or a
 * `deno --deny-all` subprocess drops in behind it without the
 * tool layer knowing.
 */

export interface SandboxResult {
  ok: boolean;
  /* Whatever the program printed, capped. */
  output: string;
  /* Present when the program threw or was stopped. Safe to
     show a learner: it is the program's own error, never this
     server's. */
  error?: string;
  /* The program printed more than it was allowed to keep. Told
     to the model rather than hidden, so it does not read a cut
     list as a complete one. */
  capped?: boolean;
  ms: number;
}

export interface SandboxRunner {
  run(source: string, signal?: AbortSignal): Promise<SandboxResult>;
}

/*
 * The flags, and why each one is there.
 *
 * `--permission` with NO --allow-* grants at all. The child
 * reads its program from stdin and its own entry point from
 * --eval, so it never needs to touch the filesystem, and
 * therefore never needs a read grant. Every grant is a hole
 * somebody has to reason about later; the correct number is
 * zero.
 *
 * `--no-warnings` because the permission model prints an
 * experimental-feature warning to stderr on every start, and
 * stderr is parsed here.
 */
function childArgs(): string[] {
  return [
    "--permission",
    "--no-warnings",
    `--max-old-space-size=${Math.max(16, actions.code.memoryMb)}`,
    "--eval",
    RUNNER_SOURCE,
  ];
}

class NodeSandbox implements SandboxRunner {
  async run(source: string, signal?: AbortSignal): Promise<SandboxResult> {
    const startedAt = Date.now();

    /*
     * The wall clock, and it is longer than the vm's own
     * timeout on purpose. The inner one stops the program; this
     * one stops the PROCESS, and it only has to fire when the
     * inner one could not — a child that never started, one
     * wedged before it reached the vm call, one that ignored
     * SIGTERM. Equal values would race, and the race would be
     * won by whichever produced a less useful message.
     */
    const wallMs = actions.code.timeoutMs + 2_000;

    const child = spawn(process.execPath, childArgs(), {
      /*
       * Nothing inherited. See the header: the permission
       * model does not hide the environment, and this server's
       * environment is every secret it has.
       */
      env: {},
      cwd: undefined,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killedFor: "timeout" | "output" | "cancelled" | null = null;

    /* The output cap, enforced as bytes arrive. */
    const cap = Math.max(1_000, actions.code.maxOutputBytes) * 2;

    const stop = (reason: typeof killedFor) => {
      if (killedFor) {
        return;
      }

      killedFor = reason;
      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => stop("timeout"), wallMs);
    const onAbort = () => stop("cancelled");

    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const exit = new Promise<number | null>((resolve, reject) => {
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;

          if (stdout.length > cap) {
            stop("output");
          }
        });

        child.stderr.on("data", (chunk: string) => {
          if (stderr.length < 4_000) {
            stderr += chunk;
          }
        });

        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });

      child.stdin.on("error", () => {
        /* The child can exit before the program is fully
           written — a broken pipe here is that, not a fault. */
      });

      child.stdin.end(
        JSON.stringify({
          source,
          timeoutMs: actions.code.timeoutMs,
          maxOutputBytes: actions.code.maxOutputBytes,
        })
      );

      await exit;

      const ms = Date.now() - startedAt;

      if (killedFor === "cancelled") {
        return { ok: false, output: "", error: "The run was cancelled.", ms };
      }

      if (killedFor === "timeout") {
        return {
          ok: false,
          output: "",
          error: `The code did not finish within ${actions.code.timeoutMs}ms and was stopped.`,
          ms,
        };
      }

      if (killedFor === "output") {
        return {
          ok: false,
          output: "",
          error:
            "The code printed more output than the sandbox allows and was stopped. Print a summary rather than everything.",
          ms,
        };
      }

      try {
        const parsed = JSON.parse(stdout) as {
          ok: boolean;
          output: string;
          error: string | null;
          capped?: boolean;
        };

        return {
          ok: parsed.ok,
          output: typeof parsed.output === "string" ? parsed.output : "",
          ...(parsed.error ? { error: parsed.error } : {}),
          ...(parsed.capped ? { capped: true } : {}),
          ms,
        };
      } catch {
        /*
         * The child died without printing a result line. Almost
         * always the heap cap — V8 aborts the process rather
         * than throwing something catchable — so that is what
         * the learner is told, while the operator gets the
         * actual stderr.
         */
        if (stderr.trim()) {
          console.error(`[actions] sandbox child failed: ${stderr.trim().slice(0, 500)}`);
        }

        return {
          ok: false,
          output: "",
          error:
            "The code stopped unexpectedly. It may have run out of memory — check for something that grows without bound.",
          ms,
        };
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }
}

let runner: SandboxRunner = new NodeSandbox();

/* Swapped by the verification suite to assert on the tool
   layer without spawning processes, and the seam a container
   backend would land behind. */
export function setSandboxRunner(next: SandboxRunner): void {
  runner = next;
}

export function runJs(
  source: string,
  signal?: AbortSignal
): Promise<SandboxResult> {
  return runner.run(source, signal);
}
