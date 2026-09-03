import { Meter } from "../../components/ui";
import type { AiUsageReport } from "../../lib/aiClient";

/*
 * What the learner has spent today.
 *
 * All that survives of SourceSwitcher, which used to sit above
 * this and ask whose account should answer. That question is
 * gone: BuildGentic pays for every request now, nobody connects a
 * key, and a control offering one choice is not a control.
 *
 * The numbers are read from the same rows the server's quota
 * gate counts, so what a learner sees and what actually stops
 * them cannot drift apart.
 */

export function UsageMeters({ usage }: { usage: AiUsageReport | null }) {
  if (!usage) {
    return null;
  }

  const { limits, used, platform } = usage;

  /* Zero means "no limit" server-side, and a meter for it would
     be a bar that never moves. */
  const meters = [
    limits.requestsPerDay > 0 ? (
      <Meter
        key="requests"
        label="Requests today"
        used={used.requestsToday}
        limit={limits.requestsPerDay}
      />
    ) : null,

    limits.tokensPerDay > 0 ? (
      <Meter
        key="tokens"
        label="Tokens today"
        used={used.tokensToday}
        limit={limits.tokensPerDay}
      />
    ) : null,

    /*
     * BuildGentic's own ceiling — the limit that can stop a
     * learner for reasons which have nothing to do with them.
     * Shown so that being stopped by it is not a surprise.
     */
    platform.budget.dailyTokens > 0 ? (
      <Meter
        key="platform"
        label="Shared budget (everyone)"
        used={platform.used.tokensToday}
        limit={platform.budget.dailyTokens}
        unit="tokens"
      />
    ) : null,
  ].filter(Boolean);

  if (meters.length === 0) {
    return null;
  }

  return (
    <div className="source__meters">
      {meters}

      {used.inFlight > 0 ? (
        <p className="source__inflight">
          {used.inFlight} request{used.inFlight === 1 ? "" : "s"} of yours still
          running.
        </p>
      ) : null}
    </div>
  );
}
