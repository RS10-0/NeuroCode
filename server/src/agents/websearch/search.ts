import { webSearch } from "../../ai/config";
import { normalizeError } from "../../ai/errors";
import type { ChatMessage } from "../../ai/types";
import { activeSearchProvider } from "../../search/SearchRegistry";
import { registerSearchProviders } from "../../search/providers";
import { runWebSearch } from "../../search/WebSearchRuntime";
import type { WebSearchTelemetry } from "../../search/types";
import {
  EMPTY_WEB_CONTEXT,
  renderWebContext,
  renderWebNotice,
  type RenderedWebContext,
} from "./context";
import { buildPlanPrompt, parsePlan, type SearchPlan } from "./plan";

/*
 * One turn of Web Search, end to end.
 *
 * Decide, search, render — and the one rule that governs the
 * whole file: this never throws. An agent that cannot search
 * must still answer, because the alternative is a deployed
 * endpoint that starts returning 503s when a search provider
 * has a bad ten minutes, and because most questions do not need
 * the web at all, which is a normal outcome rather than a
 * fault.
 *
 * So every failure below becomes a reason code and an empty
 * result. The runtime carries on, the answer is produced
 * without web context, the Test panel is told what happened,
 * and the failed call's own ai_usage row already carries the
 * real error code for anybody reading the ledger.
 *
 * The decision call is injected rather than imported. This
 * module needs to ask the model a question, and the only thing
 * in this project allowed to ask a model anything is
 * AiRuntime.runChat — which is the file that calls this one. An
 * import back would be a cycle; a parameter is the same
 * dependency written down honestly, and it means the planner
 * inherits every gate runChat enforces rather than a second
 * copy of them.
 */

export interface AskOptions {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
}

export type Ask = (options: AskOptions) => Promise<string>;

export interface AgentWebSearchInput {
  userId: string;
  /* Present once the agent has been saved. An unsaved draft in
     the Builder searches perfectly well; it simply has no id to
     attribute the usage rows to. */
  agentId?: string;
  /* The agent's own instructions, so the decision knows what
     the agent is for. */
  instructions?: string;
  messages: ChatMessage[];
  ask: Ask;
  signal?: AbortSignal;
  /* Injectable so a test can pin the date the prompt states. */
  now?: Date;
}

export interface AgentWebSearchOutcome extends RenderedWebContext {
  telemetry: WebSearchTelemetry;
}

function provider() {
  registerSearchProviders();
  return activeSearchProvider().id;
}

/*
 * An outcome with no sources in it.
 *
 * Not always an empty prompt, though, and that distinction is
 * the point. When the agent decided it did not need the web,
 * nothing is added — it is answering the way any other agent
 * would. When it tried and failed, or tried and found nothing,
 * the prompt says so: see renderWebNotice, and the measured
 * hallucination that put it there.
 */
function nothing(
  reason: WebSearchTelemetry["reason"],
  extra: Partial<WebSearchTelemetry> = {}
): AgentWebSearchOutcome {
  const notice =
    reason === "unavailable" || reason === "no_results"
      ? renderWebNotice(reason)
      : "";

  return {
    ...EMPTY_WEB_CONTEXT,
    ...(notice ? { text: notice, chars: notice.length } : {}),
    telemetry: {
      searched: false,
      queries: [],
      provider: provider(),
      resultCount: 0,
      sources: [],
      latencyMs: 0,
      reason,
      ...extra,
    },
  };
}

export async function runAgentWebSearch(
  input: AgentWebSearchInput
): Promise<AgentWebSearchOutcome> {
  const now = input.now ?? new Date();

  /* Nothing to decide about. The runtime does not reach here
     without a user turn, but a guard is cheaper than the
     empty-query provider call it would otherwise produce. */
  if (input.messages.length === 0) {
    return nothing("not_needed");
  }

  const prompt = buildPlanPrompt({
    instructions: input.instructions,
    messages: input.messages,
    now,
  });

  let decision: SearchPlan | null = null;
  let attempts = 0;

  /*
   * Asked twice at most, and the second attempt is not
   * belt-and-braces — it is the difference between the
   * capability working and not.
   *
   * The decision call asks a model that thinks before it answers
   * for one line of JSON under a small output cap. Occasionally
   * the thinking eats the cap and the reply comes back empty, or
   * comes back as prose. Either way the agent silently stops
   * searching for that turn, which a learner reads as "the
   * switch does nothing" — the exact impression this feature has
   * to avoid. It was measured happening, so it is handled.
   *
   * Only the two failures a second attempt could plausibly fix
   * are retried. A quota refusal or a dead provider is not
   * retried here: nothing about asking again makes it likelier
   * to work, and the answer is waiting.
   */
  while (!decision && attempts < 2) {
    attempts += 1;

    try {
      const reply = await input.ask({
        system: prompt.system,
        messages: prompt.messages,
        /* It writes one line of JSON. The cap is generous
           relative to that, because a model that spends part of
           it thinking must still have room to answer. */
        maxOutputTokens: Math.max(1, webSearch.planTokens),
        /*
         * Zero, because this is a decision rather than a piece of
         * writing. The same question should reach the same answer
         * twice running, and an agent that searches on Tuesday
         * and does not on Wednesday is one a learner cannot
         * reason about.
         */
        temperature: 0,
      });

      decision = parsePlan(reply);

      if (!decision) {
        console.error(
          `[websearch] plan for agent ${
            input.agentId ?? "(draft)"
          } was not a decision this could read${
            attempts < 2 ? "; asking once more" : ""
          }.`
        );
      }
    } catch (error) {
      /*
       * The decision call failed: an empty reply, a quota, a
       * provider outage, a cancelled request. Logged and
       * swallowed — the learner asked a question and is about to
       * get an answer, and turning this into a refusal would be
       * the wrong trade every time.
       */
      const failure = normalizeError(error);

      console.error(
        `[websearch] plan failed for agent ${input.agentId ?? "(draft)"}: ${
          failure.code
        } — ${failure.internalDetail ?? failure.message}`
      );

      if (
        failure.code !== "empty_response" &&
        failure.code !== "provider_malformed_response"
      ) {
        break;
      }
    }
  }

  if (!decision) {
    return nothing("unavailable");
  }

  if (!decision.search) {
    /* The common case, and not a fault: the agent read the
       question and concluded the live web could not improve
       the answer. */
    return nothing("not_needed");
  }

  let outcome;

  try {
    outcome = await runWebSearch({
      userId: input.userId,
      queries: decision.queries,
      agentId: input.agentId,
      signal: input.signal,
    });
  } catch (error) {
    /* A refusal that happened before any provider was reached —
       a search quota, a power source that will not resolve. */
    const failure = normalizeError(error);

    console.error(
      `[websearch] search failed for agent ${input.agentId ?? "(draft)"}: ${
        failure.code
      } — ${failure.internalDetail ?? failure.message}`
    );

    return nothing("unavailable", { queries: decision.queries });
  }

  if (outcome.failed) {
    return nothing("unavailable", {
      queries: outcome.queries,
      provider: outcome.provider,
      latencyMs: outcome.latencyMs,
    });
  }

  if (outcome.results.length === 0) {
    /*
     * Searched, and the web had nothing. `searched: true`,
     * because it did — the Test panel says "found nothing"
     * rather than "did not look", and those are different
     * things for the person deciding whether their agent is
     * working.
     */
    return nothing("no_results", {
      searched: true,
      queries: outcome.queries,
      provider: outcome.provider,
      latencyMs: outcome.latencyMs,
    });
  }

  const rendered = renderWebContext(outcome.results, now);

  return {
    ...rendered,
    telemetry: {
      searched: true,
      queries: outcome.queries,
      provider: outcome.provider,
      /* What came back, before the context budget decided how
         many fit. Always at least sources.length. */
      resultCount: outcome.results.length,
      sources: rendered.sources,
      latencyMs: outcome.latencyMs,
    },
  };
}
