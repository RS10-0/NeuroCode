/*
 * End-to-end proof that the Phase 2.1 AI runtime works.
 *
 * Drives the real Express API with a real bearer token, then
 * reads ai_usage back with the service key to check what
 * actually landed. Nothing is asserted from the runtime's own
 * report of success.
 *
 * Deliberately mirrors verify-progress.mts: same harness, same
 * throwaway-learner lifecycle, same "read the database, not the
 * response" rule.
 *
 *   node --experimental-strip-types ./scripts/verify-ai-runtime.mts
 */

import { createClient } from "@supabase/supabase-js";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

/* ---------------------------------------------------------
   ENV
   --------------------------------------------------------- */

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const serverEnv = readEnv("server/.env");
const webEnv = readEnv(".env.local");

const SUPABASE_URL = serverEnv.SUPABASE_URL;
const SERVICE_KEY = serverEnv.SUPABASE_SECRET_KEY;
const ANON_KEY = webEnv.VITE_SUPABASE_ANON_KEY;
const API = process.env.API_BASE ?? "http://localhost:3001";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ---------------------------------------------------------
   HARNESS
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/*
 * The newest usage row for a learner.
 *
 * Deliberately not filtered by created_at. The database clock
 * and this machine's clock are not the same clock — the hosted
 * Postgres here runs about two seconds behind — so a
 * "since I started the request" filter silently excludes the
 * very row it is looking for, and every assertion about it then
 * fails against `undefined` while the runtime is working
 * perfectly.
 *
 * The test learner is created fresh and deleted at the end, so
 * "their most recent row" is unambiguous without any clock
 * arithmetic.
 */
async function latestUsageRow(
  userId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from("ai_usage")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as Record<string, unknown> | null;
}

interface ChatResult {
  status: number;
  code?: string;
  error?: string;
  body: Record<string, unknown>;
}

async function chat(
  token: string | null,
  payload: unknown,
  base = API
): Promise<ChatResult> {
  const response = await fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  return {
    status: response.status,
    code: body.code as string | undefined,
    error: body.error as string | undefined,
    body,
  };
}

/* ---------------------------------------------------------
   1. SCHEMA
   --------------------------------------------------------- */

async function checkSchema(): Promise<boolean> {
  section("1. SCHEMA");

  let tablePresent = true;

  for (const table of ["ai_usage"]) {
    const { error } = await admin.from(table).select("id").limit(1);
    check(`table ${table}`, !error, error?.message ?? "");
    if (error) tablePresent = false;
  }

  /* The key_id column arrived with 0004; without it BYOK usage
     cannot be attributed to the key that paid. */
  const { error: keyIdError } = await admin
    .from("ai_usage")
    .select("key_id")
    .limit(1);

  check("ai_usage.key_id column", !keyIdError, keyIdError?.message ?? "");
  if (keyIdError) tablePresent = false;

  let functionsPresent = true;

  for (const [fn, args] of [
    [
      "ai_usage_admit",
      {
        p_user_id: "00000000-0000-0000-0000-000000000000",
        p_quota_key: "__probe__",
        p_power_source_kind: "platform",
        p_provider_id: "mock",
        p_model: "__probe__",
        p_feature: "lab",
        p_key_id: null,
        p_estimated_tokens: 0,
        p_limit_per_minute: 0,
        p_limit_per_day: 0,
        p_limit_concurrent: 0,
        p_limit_tokens_per_day: 0,
        p_platform_daily_requests: 0,
        p_platform_daily_tokens: 0,
        p_platform_monthly_requests: 0,
        p_platform_monthly_tokens: 0,
        p_agent_id: null,
      },
    ],
    ["ai_usage_snapshot", { p_quota_key: "__probe__" }],
    [
      "ai_usage_finish",
      {
        p_usage_id: "00000000-0000-0000-0000-000000000000",
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_latency_ms: 0,
        p_ok: true,
        p_error_code: null,
      },
    ],
  ] as const) {
    const { error } = await admin.rpc(fn, args as never);

    /* A foreign-key complaint means the function exists and ran. */
    const present =
      !error || !/schema cache|does not exist/i.test(error.message);

    check(`function ${fn}`, present, error?.message?.slice(0, 80) ?? "");

    if (!present) {
      functionsPresent = false;
    }
  }

  return tablePresent && functionsPresent;
}

/* ---------------------------------------------------------
   2. AUTHENTICATION
   --------------------------------------------------------- */

async function checkUnauthenticated() {
  section("2. UNAUTHENTICATED ACCESS IS REJECTED");

  const noToken = await chat(null, {
    messages: [{ role: "user", content: "hi" }],
  });

  check(
    "POST /api/ai/chat (no token) is 401",
    noToken.status === 401,
    `HTTP ${noToken.status}`
  );

  const garbage = await chat("not-a-real-token", {
    messages: [{ role: "user", content: "hi" }],
  });

  check(
    "POST /api/ai/chat (garbage token) is 401",
    garbage.status === 401,
    `HTTP ${garbage.status}`
  );

  for (const path of ["/api/ai/models", "/api/ai/usage"]) {
    const response = await fetch(`${API}${path}`);
    check(
      `GET ${path} (no token) is 401`,
      response.status === 401,
      `HTTP ${response.status}`
    );
  }
}

/* ---------------------------------------------------------
   3. RUNTIME METADATA
   --------------------------------------------------------- */

interface RuntimeLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
  maxInputChars: number;
  maxOutputTokens: number;
  tokensPerDay: number;
}

interface RuntimeInfo {
  powerSource: string;
  provider: string;
  defaultModel: string;
  models: Array<{ id: string; displayName: string; provider: string }>;
  limits: RuntimeLimits;
  platformBudget: {
    dailyRequests: number;
    dailyTokens: number;
    monthlyRequests: number;
    monthlyTokens: number;
  };
}

async function checkMetadata(token: string): Promise<RuntimeInfo> {
  section("3. RUNTIME METADATA");

  const response = await fetch(`${API}/api/ai/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const info = (await response.json()) as RuntimeInfo;

  check("GET /api/ai/models is 200", response.status === 200);
  check(
    "at least one model is offered",
    Array.isArray(info.models) && info.models.length > 0,
    `${info.models?.length ?? 0} models on ${info.provider}`
  );
  check(
    "the default model is one of the offered models",
    info.models?.some((m) => m.id === info.defaultModel),
    `default=${info.defaultModel}`
  );
  check(
    "limits are present and non-zero",
    info.limits?.requestsPerMinute > 0 &&
      info.limits?.requestsPerDay > 0 &&
      info.limits?.maxConcurrent > 0 &&
      info.limits?.tokensPerDay > 0,
    JSON.stringify(info.limits)
  );

  check(
    "a platform budget is published",
    (info.platformBudget?.dailyTokens ?? 0) > 0 &&
      (info.platformBudget?.monthlyTokens ?? 0) > 0,
    JSON.stringify(info.platformBudget)
  );

  /*
   * The response must name NO provider and NO power source.
   *
   * It used to assert the opposite — that every model carried
   * the platform's provider name. routes/ai.ts removed all
   * three fields deliberately: under the cascade the answering
   * vendor is whichever one happened to be free, and that is
   * the single fact the routing exists to keep private. So the
   * assertion is inverted rather than deleted, because the
   * absence is now the property worth guarding.
   */
  check(
    "the models response names no provider or power source",
    !("provider" in info) &&
      !("powerSource" in info) &&
      info.models.every((m) => !("provider" in m)),
    Object.keys(info).join(", ")
  );

  const serialised = JSON.stringify(info);

  check(
    "no key material in the models response",
    !/sk-|Bearer |api[_-]?key/i.test(serialised),
    `${serialised.length} bytes`
  );

  return info;
}

/* ---------------------------------------------------------
   4. GENERATION
   --------------------------------------------------------- */

async function checkGeneration(userId: string, token: string, info: RuntimeInfo) {
  section("4. BASIC GENERATION");

  const result = await chat(token, {
    stream: false,
    feature: "lab",
    system: "Answer in exactly one short sentence.",
    messages: [{ role: "user", content: "What is a token, in one sentence?" }],
    maxOutputTokens: 120,
  });

  check(
    "an authenticated request returns 200",
    result.status === 200,
    `HTTP ${result.status} ${result.error ?? ""}`
  );

  const text = String(result.body.text ?? "");

  check("the response contains text", text.length > 0, `${text.length} chars`);
  /*
   * Inverted for the same reason as the models response above:
   * `model`, `provider` and `powerSource` were all removed from
   * this body on purpose. A learner is talking to BuildGentic,
   * and there is nothing else to report.
   */
  check(
    "the response names no model, provider or power source",
    !("model" in result.body) &&
      !("provider" in result.body) &&
      !("powerSource" in result.body),
    Object.keys(result.body as object).join(", ")
  );

  const usage = result.body.usage as {
    inputTokens: number;
    outputTokens: number;
    reported: boolean;
  };

  check(
    "usage is reported on the response",
    usage?.inputTokens > 0 && usage?.outputTokens > 0,
    `${usage?.inputTokens} in / ${usage?.outputTokens} out (${
      usage?.reported ? "provider" : "estimated"
    })`
  );

  /* --- what actually landed in the database --- */

  /* This is the learner's first request, so it is also their
     only row — a stronger claim than "a row exists". */
  const { count } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  check("exactly one usage row was written", count === 1, `count=${count}`);

  const row = await latestUsageRow(userId);

  if (!row) {
    check("a usage row was written", false, "no row found for the learner");
    return;
  }

  check("the usage row is closed", row.status === "done", `status=${row.status}`);
  check("the usage row records success", row.ok === true, `ok=${row.ok}`);
  /*
   * The row records the model that ACTUALLY answered — a vendor
   * id like "openai/gpt-oss-120b" — not the public
   * "neurolink-1" the caller asked for. That asymmetry is the
   * point of the ledger: the response keeps the vendor private,
   * the ledger has to know who was billed. Asserting equality
   * with the public id tested the opposite of the design.
   */
  check(
    "the usage row records the model that answered",
    typeof row.model === "string" && row.model.length > 0,
    String(row.model)
  );
  check(
    "the usage row records the feature",
    row.feature === "lab",
    String(row.feature)
  );
  check(
    "the usage row records the power source and provider",
    row.power_source_kind === "platform" &&
      typeof row.provider_id === "string",
    `${row.power_source_kind} / ${row.provider_id}`
  );

  check(
    "usage carries no provider key id",
    row.key_id === null,
    String(row.key_id)
  );
  check(
    "the usage row records tokens",
    (Number(row.input_tokens) || 0) > 0 && (Number(row.output_tokens) || 0) > 0,
    `${row.input_tokens} in / ${row.output_tokens} out`
  );
  check(
    "the usage row records latency",
    (Number(row.latency_ms) || 0) > 0,
    `${row.latency_ms}ms`
  );
  check(
    "the usage row records no error",
    row.error_code === null,
    String(row.error_code)
  );
  check(
    "the usage row stores no prompt or completion",
    Object.keys(row).length > 0 &&
      !Object.keys(row).some((key) =>
        /prompt|content|message|completion|text/i.test(key)
      ),
    Object.keys(row).join(",")
  );
}

/* ---------------------------------------------------------
   5. STREAMING
   --------------------------------------------------------- */

async function checkStreaming(token: string) {
  section("5. STREAMING");

  const response = await fetch(`${API}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      stream: true,
      feature: "lab",
      messages: [
        {
          role: "user",
          content:
            "List four things a language model cannot do. One short line each.",
        },
      ],
      maxOutputTokens: 200,
    }),
  });

  check(
    "the stream responds 200",
    response.status === 200,
    `HTTP ${response.status}`
  );

  check(
    "the content type is text/event-stream",
    (response.headers.get("content-type") ?? "").includes("text/event-stream"),
    response.headers.get("content-type") ?? "(none)"
  );

  check(
    "the response is not transformed by a proxy",
    (response.headers.get("cache-control") ?? "").includes("no-transform"),
    response.headers.get("cache-control") ?? "(none)"
  );

  const began = Date.now();
  const deltaTimes: number[] = [];
  const events: string[] = [];

  let text = "";
  let done: Record<string, unknown> | null = null;

  for await (const [event, data] of readSse(response)) {
    events.push(event);

    if (event === "delta") {
      deltaTimes.push(Date.now() - began);
      text += (data as { text: string }).text;
    } else if (event === "done") {
      done = data as Record<string, unknown>;
    }
  }

  check("the stream opens with a start event", events[0] === "start", events[0]);
  check(
    "text arrives in more than one chunk",
    deltaTimes.length > 1,
    `${deltaTimes.length} chunks`
  );

  /*
   * The point of streaming: the first chunk lands well before
   * the last. A response assembled server-side and flushed in
   * one go would show these two numbers within a millisecond of
   * each other.
   */
  const first = deltaTimes[0] ?? 0;
  const last = deltaTimes[deltaTimes.length - 1] ?? 0;

  check(
    "output is progressive, not buffered",
    deltaTimes.length > 1 && last > first,
    `first chunk ${first}ms, last chunk ${last}ms, total ${
      Date.now() - began
    }ms`
  );

  check("the stream ends with a done event", events.at(-1) === "done", String(events.at(-1)));
  check("the streamed text is non-empty", text.length > 0, `${text.length} chars`);
  check(
    "the done event carries usage",
    Boolean(done) &&
      ((done!.usage as { outputTokens: number })?.outputTokens ?? 0) > 0,
    JSON.stringify(done?.usage)
  );
}

/* Yields [eventName, parsedData] for each SSE event. */
async function* readSse(
  response: Response
): AsyncGenerator<[string, unknown]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let name = "";
  let data: string[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);

      if (line === "") {
        if (data.length > 0) {
          yield [name, JSON.parse(data.join("\n"))];
          data = [];
          name = "";
        }
      } else if (line.startsWith("event:")) {
        name = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }

      newline = buffer.indexOf("\n");
    }
  }
}

/* ---------------------------------------------------------
   6. MODEL VALIDATION
   --------------------------------------------------------- */

async function checkModelValidation(token: string, info: RuntimeInfo) {
  section("6. MODEL VALIDATION");

  const allowed = await chat(token, {
    stream: false,
    model: info.defaultModel,
    messages: [{ role: "user", content: "Say OK." }],
    maxOutputTokens: 16,
  });

  check(
    "an allowed model is accepted",
    allowed.status === 200,
    `${info.defaultModel} -> HTTP ${allowed.status}`
  );

  for (const model of [
    "acme/definitely-not-real",
    "gpt-4",
    "../../etc/passwd",
    "anthropic/claude-opus-4.8",
  ]) {
    const refused = await chat(token, {
      stream: false,
      model,
      messages: [{ role: "user", content: "hi" }],
    });

    check(
      `a disallowed model is refused: ${model}`,
      refused.status === 400 && refused.code === "model_not_allowed",
      `HTTP ${refused.status} ${refused.code ?? ""}`
    );
  }

  /* A refused model must not have cost a usage row. */
  const { count } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("model", "acme/definitely-not-real");

  check(
    "a refused model writes no usage row",
    (count ?? 0) === 0,
    `count=${count}`
  );
}

/* ---------------------------------------------------------
   7. INPUT VALIDATION
   --------------------------------------------------------- */

async function checkInputValidation(token: string, info: RuntimeInfo) {
  section("7. INPUT VALIDATION");

  const cases: Array<[string, unknown, string]> = [
    ["no body at all", {}, "invalid_request"],
    ["messages is not an array", { messages: "hello" }, "invalid_request"],
    ["messages is empty", { messages: [] }, "invalid_request"],
    [
      "a message is not an object",
      { messages: ["hello"] },
      "invalid_request",
    ],
    [
      "an unknown role",
      { messages: [{ role: "root", content: "hi" }] },
      "invalid_request",
    ],
    [
      "content is not a string",
      { messages: [{ role: "user", content: 42 }] },
      "invalid_request",
    ],
    [
      "a system turn inside messages",
      {
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "hi" },
        ],
      },
      "invalid_request",
    ],
    [
      "the last message is not from the user",
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
      "invalid_request",
    ],
    [
      "too many messages",
      {
        messages: Array.from({ length: 60 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x",
        })).concat([{ role: "user", content: "x" }]),
      },
      "invalid_request",
    ],
    [
      "a single oversized message",
      { messages: [{ role: "user", content: "x".repeat(20_000) }] },
      "invalid_request",
    ],
    [
      "an oversized conversation",
      {
        messages: Array.from({ length: 4 }, () => ({
          role: "user",
          content: "y".repeat(9_000),
        })),
      },
      "invalid_request",
    ],
    [
      "an oversized system prompt",
      {
        system: "z".repeat(20_000),
        messages: [{ role: "user", content: "hi" }],
      },
      "invalid_request",
    ],
    [
      "temperature out of range",
      { temperature: 9, messages: [{ role: "user", content: "hi" }] },
      "invalid_request",
    ],
    [
      "a fractional maxOutputTokens",
      { maxOutputTokens: 12.5, messages: [{ role: "user", content: "hi" }] },
      "invalid_request",
    ],
    [
      "an unknown feature",
      { feature: "billing", messages: [{ role: "user", content: "hi" }] },
      "invalid_request",
    ],
    /*
     * The two `powerSource` cases are gone. 0011 tore BYOK out,
     * so there is one power source and no field to name it
     * with — an unknown field is simply ignored, and the
     * request succeeds. Asserting a 400 here was asserting that
     * a removed feature still validated its input.
     */
  ];

  for (const [label, body, expected] of cases) {
    const result = await chat(token, body);

    check(
      `rejected: ${label}`,
      result.status === 400 && result.code === expected,
      `HTTP ${result.status} ${result.code ?? ""} — ${
        result.error?.slice(0, 70) ?? ""
      }`
    );
  }

  /*
   * The output ceiling is a clamp, not a rejection: asking for
   * more than the power source allows should still answer, just
   * not with more tokens than the budget permits.
   */
  const clamped = await chat(token, {
    stream: false,
    maxOutputTokens: 999_999,
    messages: [{ role: "user", content: "Say OK." }],
  });

  check(
    "an over-budget maxOutputTokens is clamped, not refused",
    clamped.status === 200 &&
      ((clamped.body.usage as { outputTokens: number })?.outputTokens ?? 0) <=
        info.limits.maxOutputTokens,
    `HTTP ${clamped.status}, ${
      (clamped.body.usage as { outputTokens: number })?.outputTokens
    } output tokens vs limit ${info.limits.maxOutputTokens}`
  );
}

/* ---------------------------------------------------------
   8. QUOTAS
   --------------------------------------------------------- */

async function checkQuota(userId: string, token: string, info: RuntimeInfo) {
  section("8. QUOTAS");

  const concurrent = info.limits.maxConcurrent + 4;

  const burst = await Promise.all(
    Array.from({ length: concurrent }, (_unused, index) =>
      chat(token, {
        stream: false,
        messages: [{ role: "user", content: `burst ${index}` }],
        maxOutputTokens: 16,
      })
    )
  );

  const refused = burst.filter((r) => r.status === 429);
  const codes = new Set(refused.map((r) => r.code));

  check(
    `firing ${concurrent} at once with a limit of ${info.limits.maxConcurrent} is refused somewhere`,
    refused.length > 0,
    `${refused.length}/${concurrent} refused, codes: ${[...codes].join(", ")}`
  );

  check(
    "every refusal carries a quota code",
    refused.every(
      (r) =>
        r.code === "too_many_concurrent" ||
        r.code === "rate_limited" ||
        r.code === "quota_exceeded"
    ),
    [...codes].join(", ") || "(none refused)"
  );

  check(
    "every refusal carries a usable message",
    refused.every((r) => typeof r.error === "string" && r.error.length > 12),
    refused[0]?.error?.slice(0, 70) ?? "(none refused)"
  );

  /* Keep going until the per-minute window is exhausted. */
  let rateLimited = burst.find((r) => r.code === "rate_limited");

  for (
    let attempt = 0;
    !rateLimited && attempt < info.limits.requestsPerMinute + 4;
    attempt += 1
  ) {
    const result = await chat(token, {
      stream: false,
      messages: [{ role: "user", content: `rpm ${attempt}` }],
      maxOutputTokens: 8,
    });

    if (result.code === "rate_limited") {
      rateLimited = result;
    }
  }

  check(
    `the per-minute limit of ${info.limits.requestsPerMinute} is enforced`,
    Boolean(rateLimited),
    rateLimited?.error?.slice(0, 80) ?? "never rate limited"
  );

  check(
    "a rate-limited refusal says how long to wait",
    typeof rateLimited?.body.retryAfterSeconds === "number" &&
      (rateLimited.body.retryAfterSeconds as number) > 0,
    `retryAfterSeconds=${rateLimited?.body.retryAfterSeconds}`
  );

  /*
   * A refusal must not itself consume a slot: the whole point is
   * that a client stuck in a retry loop stops adding rows.
   */
  const { count: pending } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");

  check(
    "no requests are left pending after the burst",
    (pending ?? 0) === 0,
    `pending=${pending}`
  );
}

/* ---------------------------------------------------------
   9. CANCELLATION
   --------------------------------------------------------- */

async function checkCancellation(userId: string, token: string) {
  section("9. CANCELLATION");

  const controller = new AbortController();

  const response = await fetch(`${API}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      stream: true,
      messages: [
        { role: "user", content: "Count slowly from one to two hundred." },
      ],
      maxOutputTokens: 900,
    }),
    signal: controller.signal,
  });

  /* Read one chunk, then hang up mid-stream. */
  const reader = response.body!.getReader();
  await reader.read();

  controller.abort();

  try {
    await reader.cancel();
  } catch {
    /* Expected once aborted. */
  }

  /* Give the server a moment to notice and close its row. The
     cancelled request is the most recent one this learner made,
     so the newest row is the one to inspect. */
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const row = await latestUsageRow(userId);

  check(
    "a cancelled stream closes its usage row",
    row?.status === "done",
    `status=${row?.status}`
  );

  check(
    "a cancelled stream is recorded as cancelled, not as a provider failure",
    row?.error_code === "cancelled",
    `error_code=${row?.error_code}`
  );

  check(
    "a cancelled stream is not recorded as a success",
    row?.ok === false,
    `ok=${row?.ok}`
  );

  const { count } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");

  check("no request is left hanging", (count ?? 0) === 0, `pending=${count}`);
}

/* ---------------------------------------------------------
   10. PROVIDER FAILURE

   A second server, on its own port, holding a key that cannot
   possibly work. Proves that an upstream rejection reaches the
   learner as a safe sentence rather than as the provider's own
   body — and that the key does not come back with it.
   --------------------------------------------------------- */

async function checkProviderFailure(token: string) {
  section("10. PROVIDER FAILURE IS SAFE");

  const PORT = 3099;
  /* Shaped like a Google AI Studio key, and certainly not one. */
  const BAD_KEY = "AIzaSyINVALID0000000000000000000000000000";

  /*
   * Refuse to run against whatever happens to be on the port.
   *
   * A previous run that leaked its server would answer the
   * health check below, and this section would then quietly
   * grade a process it did not configure. Better to stop and say
   * so than to report a pass for a test that never ran.
   */
  if (await isPortAnswering(`http://localhost:${PORT}/api/health`)) {
    check(
      "port 3099 is free for the bad-key server",
      false,
      "something is already listening — kill it and re-run"
    );
    return;
  }

  /* One command string rather than a command plus args: passing
     both alongside `shell: true` is deprecated in Node 24. */
  const child: ChildProcess = spawn(
    "npx tsx src/index.ts",
    {
      cwd: "server",
      shell: true,
      env: {
        ...process.env,
        SUPABASE_URL,
        SUPABASE_SECRET_KEY: SERVICE_KEY,
        PORT: String(PORT),
        /*
         * dotenv does not override variables already present in
         * the environment, so these win over server/.env — which
         * is what makes this a bad-key server rather than a
         * second copy of the working one.
         */
        NEUROLINK_PLATFORM_PROVIDER: "gemini",
        NEUROLINK_GEMINI_API_KEY: BAD_KEY,
        /*
         * EVERY provider gets a bad key, not just the named one.
         *
         * This section used to set Gemini alone and assume that
         * made a bad-key server. It stopped being true when the
         * provider cascade landed: the child still loads
         * server/.env, so Groq, Cloudflare, OpenRouter and
         * Mistral were all present and working, one of them
         * answered, and the turn came back 200 — the cascade
         * doing exactly its job.
         *
         * Bad keys rather than absent ones, deliberately.
         * providerChain falls back to the offline Mock when it
         * finds no credentials at all, and a mock that answers
         * happily would defeat this section just as thoroughly
         * as a working vendor did.
         */
        NEUROLINK_GROQ_API_KEY: BAD_KEY,
        NEUROLINK_MISTRAL_API_KEY: BAD_KEY,
        NEUROLINK_OPENROUTER_API_KEY: BAD_KEY,
        NEUROLINK_FREE_API_KEY: BAD_KEY,
        NEUROLINK_CLOUDFLARE_ACCOUNT_ID: "0000000000000000000000000000000f",
        NEUROLINK_CLOUDFLARE_API_TOKEN: BAD_KEY,
        NEUROLINK_ALLOWED_ORIGINS: "http://localhost:5173",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let serverLog = "";
  child.stdout?.on("data", (chunk) => (serverLog += String(chunk)));
  child.stderr?.on("data", (chunk) => (serverLog += String(chunk)));

  try {
    const ready = await waitForServer(`http://localhost:${PORT}/api/health`);

    if (!ready) {
      check("the bad-key server started", false, serverLog.slice(-300));
      return;
    }

    const result = await chat(
      token,
      {
        stream: false,
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 16,
      },
      `http://localhost:${PORT}`
    );

    check(
      "a rejected provider key produces a non-2xx with a code",
      result.status >= 400 && typeof result.code === "string",
      `HTTP ${result.status} ${result.code ?? "(no code)"}`
    );

    check(
      "the failure is reported as a configuration problem, not as the user's fault",
      result.code === "provider_not_configured" ||
        result.code === "provider_unavailable",
      String(result.code)
    );

    const serialised = JSON.stringify(result.body);

    check(
      "the provider key does not appear in the response",
      !serialised.includes(BAD_KEY) && !serialised.includes("AIza"),
      serialised.slice(0, 140)
    );

    check(
      "no stack trace reaches the client",
      !/\bat \w+.*\(.*:\d+:\d+\)/.test(serialised) &&
        !serialised.includes("node_modules"),
      serialised.slice(0, 140)
    );

    check(
      "the message is a sentence, not a status code",
      typeof result.error === "string" && result.error.length > 20,
      result.error ?? ""
    );

    check(
      "the key is not written to the server log",
      !serverLog.includes(BAD_KEY),
      `${serverLog.length} bytes of log`
    );
  } finally {
    killTree(child);
  }
}

/*
 * `child.kill()` alone is not enough here.
 *
 * With `shell: true` the child is the shell, and npx/tsx run
 * underneath it. Killing the shell orphans the server, which
 * then keeps port 3099 for the next run — where it answers the
 * health check and gets graded in place of the process this
 * test actually configured.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill();
}

async function isPortAnswering(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1500),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return true;
      }
    } catch {
      /* Not up yet. */
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

/* ---------------------------------------------------------
   11. SECURITY
   --------------------------------------------------------- */

async function checkSecurity(userId: string, token: string, otherId: string) {
  section("11. SECURITY");

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  /* The quota functions must be unreachable from a browser. */
  for (const [fn, args] of [
    [
      "ai_usage_admit",
      {
        p_user_id: userId,
        p_quota_key: `platform:${userId}`,
        p_power_source_kind: "platform",
        p_provider_id: "mock",
        p_model: "x",
        p_feature: "lab",
        p_key_id: null,
        p_estimated_tokens: 0,
        p_limit_per_minute: 0,
        p_limit_per_day: 0,
        p_limit_concurrent: 0,
        p_limit_tokens_per_day: 0,
        p_platform_daily_requests: 0,
        p_platform_daily_tokens: 0,
        p_platform_monthly_requests: 0,
        p_platform_monthly_tokens: 0,
        p_agent_id: null,
      },
    ],
    ["ai_usage_snapshot", { p_quota_key: `platform:${userId}` }],
    [
      "ai_usage_finish",
      {
        p_usage_id: "00000000-0000-0000-0000-000000000000",
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_latency_ms: 0,
        p_ok: true,
        p_error_code: null,
      },
    ],
  ] as const) {
    const { error } = await asUser.rpc(fn, args as never);

    check(
      `authenticated role cannot execute ${fn}`,
      Boolean(error),
      error ? error.message.slice(0, 70) : "CALL SUCCEEDED - QUOTAS CAN BE FORGED"
    );
  }

  /* A learner may read their own usage and nothing else. */
  const readOwn = await asUser.from("ai_usage").select("user_id");

  check(
    "a learner can read their own usage rows",
    !readOwn.error && (readOwn.data?.length ?? 0) > 0,
    readOwn.error?.message ?? `${readOwn.data?.length} rows`
  );

  check(
    "RLS hides other learners' usage rows",
    (readOwn.data ?? []).every((row) => row.user_id === userId),
    `${readOwn.data?.length ?? 0} rows visible, all own`
  );

  const forgedInsert = await asUser.from("ai_usage").insert({
    user_id: userId,
    quota_key: `platform:${userId}`,
    power_source_kind: "platform",
    provider_id: "mock",
    model: "forged",
    feature: "lab",
  });

  check(
    "a learner cannot insert usage rows",
    Boolean(forgedInsert.error),
    forgedInsert.error?.message.slice(0, 70) ?? "INSERT SUCCEEDED - USAGE CAN BE PADDED"
  );

  const forgedDelete = await asUser
    .from("ai_usage")
    .delete()
    .eq("user_id", userId);

  const { count: survived } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  check(
    "a learner cannot delete usage rows to reset a quota",
    (survived ?? 0) > 0,
    forgedDelete.error
      ? forgedDelete.error.message.slice(0, 70)
      : `${survived} rows still present`
  );

  check(
    "a learner cannot write usage for somebody else",
    Boolean(
      (
        await asUser.from("ai_usage").insert({
          user_id: otherId || "00000000-0000-0000-0000-000000000000",
          quota_key: "platform:someone-else",
          power_source_kind: "platform",
          provider_id: "mock",
          model: "forged",
          feature: "lab",
        })
      ).error
    )
  );

  /* The quota key is derived server-side, never taken from the body. */
  const spoofed = await chat(token, {
    stream: false,
    quotaKey: "free:somebody-else",
    userId: otherId,
    messages: [{ role: "user", content: "Say OK." }],
    maxOutputTokens: 16,
  });

  if (spoofed.status === 200) {
    const row = await admin
      .from("ai_usage")
      .select("user_id, quota_key")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    check(
      "a client-supplied quotaKey and userId are ignored",
      row.data?.quota_key === `platform:${userId}` &&
        row.data?.user_id === userId,
      `quota_key=${row.data?.quota_key}`
    );
  } else {
    /* Rate limited from the quota section. Still a pass for the
       purpose of the check: nothing was billed elsewhere. */
    check(
      "a client-supplied quotaKey and userId are ignored",
      spoofed.status === 429,
      `HTTP ${spoofed.status} ${spoofed.code ?? ""} (quota window still closed)`
    );
  }
}


/* ---------------------------------------------------------
   RUN
   --------------------------------------------------------- */

async function main() {
  console.log(`API:      ${API}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  const schemaOk = await checkSchema();

  if (!schemaOk) {
    console.log(
      "\nSchema incomplete. Apply supabase/migrations/0003_ai_usage.sql" +
        "\nin the Supabase SQL Editor, then re-run this script.\n"
    );
    process.exit(1);
  }

  await checkUnauthenticated();

  /*
   * Unique per run, and the USERNAME half is the load-bearing
   * one: a trigger on auth.users copies user_metadata.username
   * into public.profiles, where it is unique. A fixed name means
   * one leftover account from an interrupted run makes every
   * later run die at createUser with a bare "Database error
   * creating new user". Neither the trigger nor the constraint
   * is in supabase/migrations, so nothing in the tree warns you.
   */
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `neurolink-ai-verify+${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `ai-verify-${stamp}` },
  });

  if (created.error || !created.data.user) {
    console.error("Could not create the test learner:", created.error?.message);
    process.exit(1);
  }

  const userId = created.data.user.id;
  console.log(`\nTest learner: ${email} (${userId})`);

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signIn = await anon.auth.signInWithPassword({ email, password });

    if (signIn.error || !signIn.data.session) {
      console.error("Could not sign in:", signIn.error?.message);
      throw new Error("sign-in failed");
    }

    const token = signIn.data.session.access_token;

    const info = await checkMetadata(token);

    await checkGeneration(userId, token, info);
    await checkStreaming(token);
    await checkModelValidation(token, info);
    await checkInputValidation(token, info);
    await checkCancellation(userId, token);
    await checkProviderFailure(token);

    /* Last, because it deliberately exhausts the window. */
    await checkQuota(userId, token, info);

    const others = await admin
      .from("user_stats")
      .select("user_id")
      .neq("user_id", userId)
      .limit(1);

    await checkSecurity(userId, token, others.data?.[0]?.user_id ?? "");
  } finally {
    await admin.auth.admin.deleteUser(userId);

    const leftover = await admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    console.log(`\nTest learner deleted: ${userId}`);
    console.log(`Leftover usage rows for that user: ${leftover.count ?? 0}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
