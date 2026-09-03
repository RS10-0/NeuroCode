import { actions } from "../../ai/config";
import type {
  ActionCapabilityFlags,
  ActionToolId,
  DraftedEmailEvent,
  GeneratedDocument,
} from "../../ai/types";
import type { CapturedPage } from "../extension/pageContext";
import { runJs } from "./sandbox/runJs";
import {
  BlockedAddressError,
  checkUrl,
  resolveAgainstBase,
} from "./http/addresses";
import { httpCall } from "./http/request";
import { dataTools } from "../data/tools";
import { emailTools } from "../email/tools";
import { makeDocumentTool } from "../documents/tool";

/*
 * The tools, and what the model is told about them.
 *
 * The `description` fields in this file are not documentation.
 * They are prompt text: they go into the system prompt verbatim
 * and they are the entire basis on which a model decides
 * whether to reach for a tool and what to put in it. A vague
 * description here produces an agent that uses the wrong tool,
 * and no amount of runtime validation fixes that — validation
 * can only refuse, it cannot explain.
 *
 * So each one says what the tool does, what it cannot do, and
 * what its arguments are, in that order, in the shortest form
 * that is still unambiguous. The limits are stated because a
 * model that knows the output cap will summarise instead of
 * dumping, and one that does not will spend a step finding out.
 */

/*
 * What one turn has already spent, for the tools that need a
 * per-TURN ceiling rather than a per-call one.
 *
 * `actions.maxSteps` bounds how many times a tool may run;
 * these bound how much of that budget a particular kind of work
 * may consume. Two tools need it and for different reasons: a
 * turn that produced eight files has misunderstood the request,
 * and a turn that wrote thirty records has done to the store
 * what an over-eager extraction call does to memory.
 *
 * Mutable, and held here rather than as a branch in the loop,
 * so that AiRuntime's dispatch stays generic. A tool that needs
 * a turn ceiling checks and increments its own counter; the
 * loop does not grow a case per tool.
 */
export interface TurnBudget {
  documents: number;
  dataWrites: number;
  /* Drafts written this turn. A third reason to bound one, and
     the one with a person on the other end of it: every draft
     is something somebody now has to read before they can clear
     their tray. */
  emailDrafts: number;
}

export function newTurnBudget(): TurnBudget {
  return { documents: 0, dataWrites: 0, emailDrafts: 0 };
}

export interface ToolContext {
  userId: string;
  agentId?: string;
  signal?: AbortSignal;
  /*
   * The run this turn belongs to, when a run row exists.
   *
   * Set by the scheduler and by a manual preview; absent for a
   * Test panel turn, a deployment and a page, none of which
   * have a run row to hang a document off. It is what ties a
   * generated file to the notification that will attach it —
   * the mail drain looks documents up by run id rather than the
   * notification carrying a document column.
   */
  runId?: string;
  /*
   * The web page this turn was given, when it was given one.
   *
   * Set only by the extension door, and read by exactly one
   * tool: `email_draft`. Everything else ignores it, because
   * for everything else the page is already in the prompt and a
   * tool has no business re-reading it.
   *
   * It is here so that a draft can record WHAT SHAPED IT. A
   * drafted reply is the only thing on this platform that
   * carries a captured page toward another person, and the
   * send-confirmation screen has to be able to show the learner
   * the page alongside the words before they press send — see
   * the note on `sourcePage` in email/DraftStore.ts.
   *
   * Absent everywhere else, which is every other door.
   */
  pageContext?: CapturedPage;
  /* Absent only where no tool needs it. Tools that do treat
     absence as "no budget tracking", never as "unlimited". */
  turn?: TurnBudget;
}

export interface ToolOutcome {
  ok: boolean;
  /* Goes into the prompt, fenced. */
  output: string;
  /* Present when `ok` is false. Goes into the prompt unfenced,
     as BuildGentic's own statement of what went wrong. */
  error?: string;
  /* One line for the owner's trace. Never the payload. */
  summary: string;
  /* Tool time only. */
  ms: number;
  /*
   * A file this step produced.
   *
   * The one field on this interface that is not about the
   * prompt, and the reason is that `make_document` is the first
   * tool whose value is a side effect. Everything else here
   * describes what the model will read next; this describes
   * something that now exists and has an id, which the runtime
   * turns into a `document` event for the owner's surfaces.
   *
   * Never the bytes. They are in the store, and the only way to
   * them is a session-authenticated route.
   */
  document?: GeneratedDocument;
  /*
   * An email this step drafted.
   *
   * On this interface for the reason `document` is: it
   * describes a thing that now exists and has an id, rather
   * than something the model is about to read. The runtime
   * turns it into an `email_draft` event, which is the only
   * evidence any surface accepts that a draft was written.
   *
   * Never a way to send it. There is no send tool, so there is
   * nothing on this interface that could carry one.
   */
  draft?: DraftedEmailEvent;
}

export interface ToolSpec {
  id: ActionToolId;
  /* Which capability flag has to be on for this tool to be
     offered. Resolved from the stored agent row on every door
     that is not the owner's own browser. */
  capability: keyof ActionCapabilityFlags;
  description: () => string;
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolOutcome>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/* =========================================================
   run_code
========================================================= */

const runCode: ToolSpec = {
  id: "run_code",
  capability: "codeExecution",
  description: () =>
    [
      "run_code — run JavaScript and read what it prints.",
      `  Use it for anything you would otherwise do in your head and might get wrong: arithmetic, parsing, sorting, counting, reshaping data, checking a date. It is exact where you are not.`,
      `  args: { "code": "<JavaScript>" }`,
      "  It runs on its own, with no internet, no files, and no access to this conversation. If you need data in it, write the data into the code.",
      "  Synchronous only — no await, no timers, no fetch. The standard library (JSON, Math, Date, String, Array, Map, Set, RegExp) is all there.",
      `  Print with console.log. What it prints is all you get back, capped at ${actions.resultChars} characters, so print a summary rather than everything.`,
      `  It is stopped after ${actions.code.timeoutMs}ms. If it throws, you get the error and can fix it and try again.`,
    ].join("\n"),

  async run(args, context) {
    const code = text(args.code);

    if (!code) {
      return {
        ok: false,
        output: "",
        error: 'Missing `code`. Send {"tool":"run_code","args":{"code":"..."}}.',
        summary: "no code given",
        ms: 0,
      };
    }

    if (code.length > actions.code.maxSourceChars) {
      return {
        ok: false,
        output: "",
        error: `That program is ${code.length} characters and the limit is ${actions.code.maxSourceChars}. Send something shorter.`,
        summary: "program too long",
        ms: 0,
      };
    }

    const result = await runJs(code, context.signal);

    if (!result.ok) {
      return {
        ok: false,
        output: "",
        error: result.error ?? "The code did not run.",
        summary: "the code threw",
        ms: result.ms,
      };
    }

    const output =
      result.output.length > 0
        ? result.output
        : "(the code ran and printed nothing)";

    return {
      ok: true,
      output,
      summary: `ran in ${result.ms}ms, ${result.output.length} characters printed${
        result.capped ? " (output limit reached)" : ""
      }`,
      ms: result.ms,
    };
  },
};

/* =========================================================
   http_request
========================================================= */

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

const httpTool: ToolSpec = {
  id: "http_request",
  capability: "httpActions",
  description: () =>
    [
      "http_request — call a web address and read the response.",
      "  Use it for live data: an API, a JSON feed, a public page.",
      `  args: { "url": "<address or path>", "method": "GET", "body": "<optional request body>", "connection": "<optional saved connection name>" }`,
      '  With no "connection", only public GET requests are allowed and no credentials are sent.',
      '  With a "connection", give "url" as a path relative to that connection — the address and the key are filled in for you. You are never shown the key and must never ask for it or repeat one.',
      `  The response body comes back as text, capped at ${actions.resultChars} characters. Private and internal addresses are refused.`,
      "  If the response is JSON and you need to work with it, pass it to run_code rather than doing the arithmetic yourself.",
    ].join("\n"),

  async run(args, context) {
    const startedAt = Date.now();

    const rawUrl = text(args.url);
    const connectionSlug = text(args.connection);
    const method = (text(args.method) ?? "GET").toUpperCase();
    const body = text(args.body) ?? undefined;

    if (!rawUrl) {
      return {
        ok: false,
        output: "",
        error: "Missing `url`.",
        summary: "no url given",
        ms: 0,
      };
    }

    if (body && body.length > actions.http.maxRequestBodyChars) {
      return {
        ok: false,
        output: "",
        error: `That request body is ${body.length} characters and the limit is ${actions.http.maxRequestBodyChars}.`,
        summary: "body too long",
        ms: 0,
      };
    }

    let target = rawUrl;
    const headers: Record<string, string> = {};

    if (connectionSlug) {
      if (!context.agentId) {
        return {
          ok: false,
          output: "",
          error:
            "Saved connections are only available to a saved agent. Save this agent first, or call a public address without a connection.",
          summary: "no agent for connection",
          ms: 0,
        };
      }

      /*
       * Imported here rather than at the top of the file.
       *
       * ConnectionStore reaches the Supabase client, which
       * refuses to load without SUPABASE_URL — and everything
       * else in this catalogue needs no database at all. A
       * static import would mean the sandbox, the tool
       * descriptions and the whole verification suite could
       * not be loaded on a machine without those variables,
       * for the sake of one branch that genuinely does need
       * them.
       */
      const { resolveConnection } = await import("./http/ConnectionStore");

      const connection = await resolveConnection(
        context.userId,
        context.agentId,
        connectionSlug
      );

      if (!connection) {
        return {
          ok: false,
          output: "",
          error: `There is no connection called "${connectionSlug.slice(0, 40)}". Use one of the connections listed in your instructions.`,
          summary: "unknown connection",
          ms: 0,
        };
      }

      if (!connection.allowedMethods.includes(method)) {
        return {
          ok: false,
          output: "",
          error: `The "${connection.slug}" connection does not allow ${method}. It allows ${connection.allowedMethods.join(", ")}.`,
          summary: `${method} not allowed on ${connection.slug}`,
          ms: 0,
        };
      }

      /*
       * The path is joined onto the connection's base, and the
       * result is checked to still be under it.
       *
       * `new URL(path, base)` handles the ordinary cases, and
       * the origin comparison afterwards handles the rest: a
       * path of "https://evil.example/" or "//evil.example/"
       * resolves to a different origin entirely, which is the
       * whole trick. Checking the joined result rather than
       * the input is what makes that a refusal instead of a
       * credential leak.
       */
      /*
       * The leash. See resolveAgainstBase — an absolute URL or
       * a protocol-relative "//host" both escape a naive join,
       * and either would hand this connection's key to a host
       * its owner never named.
       */
      const scoped = resolveAgainstBase(connection.baseUrl, rawUrl);

      if (!scoped.ok) {
        return {
          ok: false,
          output: "",
          error: `The "${connection.slug}" connection can only reach ${connection.baseUrl} — ${scoped.reason}.`,
          summary: "outside connection scope",
          ms: 0,
        };
      }

      const joined = scoped.url;

      if (connection.secret) {
        if (connection.authKind === "bearer") {
          headers.authorization = `Bearer ${connection.secret}`;
        } else if (connection.authKind === "header" && connection.authName) {
          headers[connection.authName] = connection.secret;
        } else if (connection.authKind === "query" && connection.authName) {
          joined.searchParams.set(connection.authName, connection.secret);
        }
      }

      target = joined.toString();
    } else {
      if (!actions.http.allowPublicGet) {
        return {
          ok: false,
          output: "",
          error:
            "This agent can only call its saved connections. Name one with `connection`.",
          summary: "public calls disabled",
          ms: 0,
        };
      }

      if (method !== "GET") {
        return {
          ok: false,
          output: "",
          error:
            "Only GET is allowed without a saved connection. Anything that changes something needs a connection its owner set up.",
          summary: `${method} refused without connection`,
          ms: 0,
        };
      }
    }

    if (body !== undefined && !METHODS_WITH_BODY.has(method)) {
      return {
        ok: false,
        output: "",
        error: `A ${method} request cannot carry a body.`,
        summary: "body on a bodyless method",
        ms: 0,
      };
    }

    try {
      checkUrl(target);
    } catch (error) {
      return {
        ok: false,
        output: "",
        error:
          error instanceof BlockedAddressError
            ? error.message
            : "That address cannot be requested.",
        summary: "address refused",
        ms: Date.now() - startedAt,
      };
    }

    try {
      const result = await httpCall({
        url: target,
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(context.signal ? { signal: context.signal } : {}),
      });

      const redirected = result.chain.length > 1;

      /*
       * A 4xx or 5xx is a real answer, not a failure of the
       * tool. The model is shown the status and the body and
       * gets to decide what it means — an API that says "no
       * such city" is information, and turning it into an
       * error would hide the one sentence that explains the
       * problem.
       */
      const output = [
        `HTTP ${result.status}${result.contentType ? ` (${result.contentType})` : ""}`,
        redirected ? `Redirected to: ${result.chain[result.chain.length - 1]}` : "",
        "",
        result.body.length > 0 ? result.body : "(empty response body)",
      ]
        .filter((line) => line !== "")
        .join("\n");

      return {
        ok: true,
        output,
        summary: `HTTP ${result.status}, ${result.bytes} bytes${
          redirected ? `, ${result.chain.length - 1} redirect(s)` : ""
        }${result.truncated ? ", truncated" : ""}`,
        ms: Date.now() - startedAt,
      };
    } catch (error) {
      const message =
        error instanceof BlockedAddressError
          ? error.message
          : error instanceof Error
            ? /* The far end's failure, not this server's. Node's
                 socket errors are terse but they are the truth,
                 and a learner debugging an endpoint needs the
                 real one. */
              error.message.slice(0, 200)
            : "The request failed.";

      return {
        ok: false,
        output: "",
        error: message,
        summary: "request failed",
        ms: Date.now() - startedAt,
      };
    }
  },
};

/* =========================================================
   THE REGISTRY
========================================================= */

/*
 * The two capabilities added in Phase 3 live in their own
 * directories and register here.
 *
 * Static imports, and safe ones: both modules pull in config,
 * the plan validator and the renderers, none of which touches a
 * database. Each of them reaches its OWN store through a
 * dynamic import inside `run`, exactly as the connection branch
 * above does, so this file's property is preserved — the
 * catalogue, and therefore every tool description and the whole
 * offline verification suite, still loads on a machine with no
 * Supabase variables set.
 */
export const TOOLS: ToolSpec[] = [
  runCode,
  httpTool,
  makeDocumentTool,
  ...dataTools,
  /*
   * The email tools, registered exactly as the others are, and
   * that sameness is the point of §0 of the Phase 3 plan: a new
   * capability is a new entry in one array, or it is wrong.
   *
   * Their stores are reached through dynamic imports inside
   * `run`, and their argument validation lives in
   * email/addresses.ts, which is a leaf — so this file still
   * loads, with every tool description intact, on a machine
   * with no Supabase variables set.
   */
  ...emailTools,
];

const BY_ID = new Map<ActionToolId, ToolSpec>(
  TOOLS.map((tool) => [tool.id, tool])
);

/*
 * The guard that makes model output safe to dispatch on.
 *
 * Every tool call goes through here before anything runs. A
 * name that is not in this map is refused, so there is no path
 * from what a model writes to a function this file does not
 * list.
 */
export function isToolId(value: string): value is ActionToolId {
  return BY_ID.has(value as ActionToolId);
}

export function toolFor(id: ActionToolId): ToolSpec | undefined {
  return BY_ID.get(id);
}

/* The tools this particular turn is allowed to use, in
   catalogue order so the prompt is stable between turns. */
export function toolsFor(flags: ActionCapabilityFlags): ToolSpec[] {
  return TOOLS.filter((tool) => flags[tool.capability] === true);
}
