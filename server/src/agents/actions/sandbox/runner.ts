/*
 * The program that runs inside the sandbox child.
 *
 * A string rather than a file, and that is deliberate. It is
 * handed to `node --eval`, so there is no path to resolve —
 * which matters twice over. The server runs from TypeScript
 * under tsx in development and from compiled output in
 * production, and a sibling `.js` file would be in a different
 * place in each. And the permission model denies filesystem
 * reads to the child, so a child that had to read its own
 * entry point would need a read grant, and every grant is a
 * hole somebody has to reason about later.
 *
 * Nothing in here is trusted with anything. It receives a
 * program on stdin, runs it, and prints a JSON line. If it is
 * subverted entirely, the process it subverts has no
 * filesystem, no subprocesses, no worker threads, no
 * environment and no network — see runJs.ts for how each of
 * those is taken away, and which layer takes it.
 */
export const RUNNER_SOURCE = String.raw`
const vm = require("node:vm");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let job;
  try {
    job = JSON.parse(input);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, output: "", error: "The sandbox could not read the program it was given." }));
    return;
  }

  const maxOutputBytes = Number(job.maxOutputBytes) || 64000;
  const timeoutMs = Number(job.timeoutMs) || 5000;

  /*
   * A context with a null prototype and nothing put into it
   * from out here.
   *
   * This is the layer that takes away the network, and it is
   * load-bearing for a reason worth writing down: Node's
   * permission model has no network permission. There is no
   * --allow-net. A --permission child cannot touch the disk
   * and cannot spawn anything, but it can open a socket to
   * anywhere, which for a program a language model wrote is
   * not an acceptable place to stop.
   *
   * So the program never gets a handle that can reach one. No
   * require, no process, no fetch — and because the globals
   * below are built by a script running INSIDE this context,
   * they are the context's own objects rather than this
   * realm's. That closes the standard escape: reaching
   * ({}).constructor.constructor gets the sandbox's Function,
   * not ours, and "return process" through it returns
   * undefined. Verified, not assumed.
   */
  const ctx = vm.createContext(Object.create(null));

  vm.runInContext(
    "(() => {" +
    "  const sink = [];" +
    /* Non-writable and non-configurable, so a program cannot
       drop the record of what it printed — accidentally with a
       stray global, or otherwise. */
    "  Object.defineProperty(globalThis, '__nlSink', { value: sink, writable: false, configurable: false, enumerable: false });" +
    "  const render = (v) => {" +
    "    if (typeof v === 'string') return v;" +
    "    if (v instanceof Error) return v.name + ': ' + v.message;" +
    "    try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; }" +
    "    catch { return String(v); }" +
    "  };" +
    /*
     * The budget is enforced HERE, as lines are printed,
     * rather than by slicing the result afterwards.
     *
     * Slicing afterwards is correct about what the model ends
     * up seeing and wrong about everything else: a loop
     * printing a long line builds the whole of it in this
     * child's heap first, and reaches the memory cap — a
     * crash with no output at all — long before anyone
     * truncates anything. Stopping at the budget means a
     * runaway print loop produces a full result and a note,
     * which is the answer a learner can act on.
     */
    "  let spent = 0;" +
    "  const budget = " + maxOutputBytes + ";" +
    "  let capped = false;" +
    "  const write = (...a) => {" +
    "    if (spent >= budget) { capped = true; return; }" +
    "    const line = a.map(render).join(' ');" +
    "    spent += line.length + 1;" +
    "    sink.push(line);" +
    "  };" +
    "  Object.defineProperty(globalThis, '__nlCapped', { get: () => capped, configurable: false, enumerable: false });" +
    /* warn and error land in the same stream on purpose. The
       model reads one blob of output; splitting it would mean
       deciding which half to show it. */
    "  globalThis.console = { log: write, info: write, warn: write, error: write, debug: write };" +
    "})()",
    ctx
  );

  let error = null;
  let completion;

  try {
    /*
     * The timeout here stops synchronous work — the busy loop,
     * the accidental O(n!) — and it is the only thing that
     * can, because a spinning script never yields to let
     * anything else act. runJs.ts adds a second, longer wall
     * clock outside the process for everything this cannot
     * see.
     */
    completion = vm.runInContext(job.source, ctx, {
      timeout: timeoutMs,
      displayErrors: true,
    });
  } catch (e) {
    error =
      e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
        ? "The code ran too long and was stopped. Check for a loop that never ends."
        : String((e && e.stack) || e).split("\n").slice(0, 4).join("\n");
  }

  let output = "";

  try {
    /*
     * String.fromCharCode(10) rather than a newline escape,
     * and not out of preference.
     *
     * This source is nested two parsers deep: it is a string
     * inside RUNNER_SOURCE, which is itself a string this
     * server hands to node --eval. A "\n" written here is
     * consumed by the child's parser before the vm ever sees
     * it, so what vm gets is a string literal with a real line
     * break inside it — a syntax error, swallowed by the catch
     * below, and visible only as output that is silently
     * always empty. Naming the character sidesteps the whole
     * question of which parser eats which backslash.
     */
    output = vm.runInContext(
      "__nlSink.splice(0, __nlSink.length).join(String.fromCharCode(10))",
      ctx,
      { timeout: 1000 }
    );
  } catch {
    output = "";
  }

  /*
   * The value of the last expression, when the program printed
   * nothing.
   *
   * Small kindness with a real effect: a model asked to
   * compute something often writes the expression and no
   * console.log, and an empty result teaches it nothing about
   * what went wrong. Only when the sink is empty, so it can
   * never contradict what the program deliberately printed.
   *
   * Primitives only. An object completion value is one of the
   * sandbox's own objects, and reading it out here would mean
   * this realm calling getters that realm defined — the exact
   * direction of travel the context exists to prevent. A
   * program that wants to return an object can print it.
   */
  if (output.length === 0 && error === null) {
    const kind = typeof completion;

    if (kind === "string" || kind === "number" || kind === "boolean" || kind === "bigint") {
      output = String(completion);
    }
  }

  /* Belt to the braces above: the in-context budget bounds
     what is printed, this bounds what a completion value or a
     single enormous line could still add. */
  let capped = output.length > maxOutputBytes;

  if (capped) {
    output = output.slice(0, maxOutputBytes);
  }

  try {
    capped = capped || vm.runInContext("__nlCapped === true", ctx, { timeout: 1000 });
  } catch {
    /* The program removed the flag. What it printed is still
       what it printed. */
  }

  process.stdout.write(
    JSON.stringify({ ok: error === null, output, error, capped })
  );
});
`;
