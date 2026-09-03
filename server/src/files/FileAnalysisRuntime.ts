import { fileAnalysis, fileLimitsFor } from "../ai/config";
import { AiRuntimeError, normalizeError } from "../ai/errors";
import { resolvePowerSource } from "../ai/resolveChain";
import { admit } from "../ai/QuotaGuard";
import { finish } from "../ai/UsageRecorder";
import type { ResolvedPowerSource } from "../ai/types";
import { extractorFor } from "./extract";
import { billedTo, put, type FileScope, type HeldFile } from "./FileStore";
import { sniff } from "./sniff";

/*
 * The entry point for every file BuildGentic reads.
 *
 * AiRuntime.runChat for files, and consciously the same shape,
 * in the same order, for the same reasons:
 *
 *   resolve who is paying
 *   → validate and constrain the request
 *   → take a quota slot
 *   → do the work
 *   → always close the usage row
 *
 * Nothing above this file decides what a file is, runs a parser,
 * counts a quota or writes a usage row. Reading a file is not a
 * model call — no provider is contacted and no tokens are spent
 * — but it is still work this server does on a learner's behalf,
 * with real CPU and real memory behind it, and there is no
 * version of this feature where that gets to skip the gate a Lab
 * prompt cannot. That is the same argument WebSearchRuntime
 * makes about a search, and it lands in the same place.
 *
 * Who pays is the agent's own power source, exactly as it is for
 * embeddings and for searching. The parsing itself is
 * BuildGentic's either way — a learner's OpenAI key does not buy
 * them a PDF reader — but the quota key, the windows and the
 * platform budget all follow the agent, so a BYOK agent's
 * uploads are counted against a BYOK learner's own allowance and
 * never against BuildGentic's platform budget.
 *
 * The one thing that does NOT happen here is the model call. An
 * image is measured and carried; it is not looked at. Looking at
 * it is `runChat`'s job, on the request that answers the
 * question, through the same power source and the same provider
 * as every other answer — which is what keeps this from becoming
 * a second AI runtime.
 */

/* =========================================================
   THE QUOTA KEY

   File traffic is counted, and counted in its own windows. See
   the note on fileLimitsFor in config.ts: a turn that analyses
   a file is an upload plus an answer, and charging both to the
   window a learner uses for the Lab would halve what they can
   do the moment they attach something.

   Derived from the source's own key rather than rebuilt from
   the user id, so the platform/BYOK split is inherited instead
   of restated — the same trick embeddingSource and searchSource
   play.
========================================================= */

export function fileSource(source: ResolvedPowerSource): ResolvedPowerSource {
  return {
    ...source,
    quotaKey: `file:${source.quotaKey}`,
    limits: fileLimitsFor(),
  };
}

export interface AnalyseInput {
  scope: FileScope;
  /* Whatever the caller called it. Untrusted. */
  name: unknown;
  /* Whatever the caller said it was. Untrusted. */
  declaredType: unknown;
  bytes: Buffer;
  /* The saved agent this upload belongs to, when one does. */
  agentId?: string;
  signal?: AbortSignal;
}

/*
 * Validates, reads, records, and holds.
 *
 * Throws AiRuntimeError for everything a caller could fix — an
 * unsupported format, an oversized file, a corrupt document, a
 * quota — with a message written for the person holding the
 * file. The route turns that into a 4xx; the deployment route
 * generalises it first.
 *
 * The order below is not arbitrary. Sniffing happens BEFORE the
 * quota slot, so a caller who uploads a video gets a refusal
 * that costs them nothing and costs BuildGentic one comparison.
 * The quota slot is taken before any parser runs, so nobody can
 * spend this server's CPU without it being counted first.
 */
export async function analyseFile(input: AnalyseInput): Promise<HeldFile> {
  /*
   * Free refusals first: is this even a file we read, and is it
   * within the byte ceilings. Both are decided from the bytes
   * alone and neither touches the database.
   */
  const accepted = sniff({
    name: input.name,
    declaredType: input.declaredType,
    bytes: input.bytes,
  });

  const source = fileSource(
    await resolvePowerSource(billedTo(input.scope))
  );

  const admission = await admit({
    userId: billedTo(input.scope),
    source,
    /*
     * `model` and `provider_id` on a file row.
     *
     * ai_usage is the ledger of work somebody paid for, and
     * reading a file is some of that even though no model ran.
     * So the row says what it actually was — the literal
     * 'file-analysis' where a model id would go, and the format
     * where a provider would go — rather than borrowing the
     * answering model's id and making the ledger read as if the
     * agent answered twice. Exactly what a `web-search` row
     * does.
     */
    model: "file-analysis",
    providerId: accepted.kind,
    feature: "agent_file_analysis",
    /* Parsing spends no model tokens. The request windows are
       what bound it. */
    estimatedTokens: 0,
    /*
     * No `keyId`. A BYOK learner's provider key buys them model
     * calls, not a PDF parser — the parsing is BuildGentic's on
     * either power source. What follows the agent is the quota
     * key and the windows, which is what `source` above already
     * carries.
     */
    agentId: input.agentId,
    /*
     * Deliberately no `deployment`.
     *
     * A deployed request takes a slot from the deployment's own
     * windows when it is admitted to ANSWER. Charging its
     * uploads to those windows as well would quietly redefine
     * "20 requests a minute" as "ten, if the caller attaches
     * something", which is not what the Deploy screen says. The
     * same reasoning WebSearchRuntime gives for its searches.
     */
  });

  const startedAt = Date.now();

  /*
   * One controller for two ways parsing can stop early: the
   * caller hangs up, or the parser runs too long.
   *
   * The timeout is the limit that matters most here and the
   * least obvious. Every size ceiling above bounds the INPUT; a
   * document crafted to make a parser loop is small. Only a
   * clock bounds that.
   */
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });

  /*
   * The floor is 50ms rather than a second.
   *
   * It exists so that a zero or a negative value in the
   * environment cannot mean "time out instantly on every
   * upload". It is deliberately not high enough to override a
   * small value somebody set on purpose — a clamp that quietly
   * ignored the configured limit would make the limit
   * untestable, which is how it stops being a limit.
   */
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(50, fileAnalysis.extractTimeoutMs));

  let failure: AiRuntimeError | null = null;

  try {
    const extracted = await extractorFor(accepted.kind).extract(
      accepted,
      controller.signal
    );

    if (timedOut) {
      throw new AiRuntimeError(
        "timeout",
        `${accepted.name} took too long to read. Try a smaller or simpler file.`
      );
    }

    if (input.signal?.aborted) {
      throw new AiRuntimeError("cancelled", "The upload was cancelled.");
    }

    return put({
      scope: input.scope,
      name: accepted.name,
      kind: accepted.kind,
      bytes: accepted.bytes.length,
      extracted,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    failure = timedOut
      ? new AiRuntimeError(
          "timeout",
          `${accepted.name} took too long to read. Try a smaller or simpler file.`
        )
      : normalizeError(error);

    if (failure.internalDetail) {
      /* Read here and nowhere else, exactly like a model
         provider's detail. It never reaches a response body, and
         a parser's own message can quote the document. */
      console.error(`[files] ${failure.code}: ${failure.internalDetail}`);
    }

    throw failure;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();

    /* Always. A pending row holds one of this learner's file
       concurrency slots until the reaper sweeps it. */
    await finish(admission.usageId, {
      usage: { inputTokens: 0, outputTokens: 0, reported: true },
      latencyMs: Date.now() - startedAt,
      ok: failure === null,
      errorCode: failure?.code,
    });
  }
}
