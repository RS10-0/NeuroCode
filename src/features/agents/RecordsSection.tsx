import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  IconButton,
  Meter,
} from "../../components/ui";
import {
  clearRecords,
  deleteRecord,
  listRecords,
  restoreRecord,
  type StoredRecord,
  type StoreUsage,
} from "./documentsApi";
import type { AgentDraft } from "./types";

/*
 * Everything the agent has written down, and the only place it
 * can be taken away.
 *
 * The same argument MemorySection makes, and it applies here
 * with one difference worth stating on the screen itself: this
 * store is not memory, and a learner who has just read that
 * section will assume it is.
 *
 * Memory holds what the agent WORKED OUT about a person, and
 * forgets its oldest entry when it fills. This holds what it
 * was ASKED TO KEEP, and refuses rather than forgetting —
 * because in a running log the oldest row is the one with the
 * most history behind it, and dropping it quietly is data loss
 * its owner never sees.
 *
 * The other thing this screen exists for is the soft delete.
 * `data_delete` lets the agent retire a record; only a person
 * destroys one. That rule is only meaningful if the retired
 * ones are visible and restorable, which is what the second
 * list below is.
 */

interface RecordsSectionProps {
  draft: AgentDraft;
  /* Null until the draft has been saved once. Records hang off
     an agent, so this is the difference between a working
     section and an explanation of why it is not. */
  agentId: string | null;
  onOpenCapabilities: () => void;
}

export default function RecordsSection({
  draft,
  agentId,
  onOpenCapabilities,
}: RecordsSectionProps) {
  const on = draft.capabilities.includes("data_store");

  const [records, setRecords] = useState<StoredRecord[] | null>(null);
  const [usage, setUsage] = useState<StoreUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentId) {
      return;
    }

    setError(null);

    try {
      const result = await listRecords(agentId);
      setRecords(result.records);
      setUsage(result.usage);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not read this agent's records."
      );
    }
  }, [agentId]);

  /*
   * The first read, on mount and on a change of agent —
   * including null becoming an id, which is what saving a draft
   * looks like.
   *
   * Written as its own async body rather than as a call to
   * `refresh`, and the difference is not cosmetic:
   * `refresh` calls setError synchronously before it awaits
   * anything, which inside an effect is the cascading render
   * the lint rule is right to object to. The same shape
   * useAgentMemory and useKnowledgeIndex use, for the same
   * reason.
   *
   * `active` guards a response that lands after the section has
   * been switched away from, which is one click away at all
   * times on this screen.
   */
  useEffect(() => {
    if (!agentId) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const result = await listRecords(agentId);

        if (active) {
          setRecords(result.records);
          setUsage(result.usage);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read this agent's records."
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);

    try {
      await run();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * Live and retired are two lists, not one with a flag.
   *
   * They answer different questions — "what does my agent know"
   * and "what did it throw away that I might want back" — and
   * only the first counts against the cap. Interleaving them
   * would make a full store look fuller than it is.
   */
  const live = (records ?? []).filter((record) => record.retiredAt === null);
  const retired = (records ?? []).filter((record) => record.retiredAt !== null);

  return (
    <section className="agentsec" aria-labelledby="agentsec-records">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-records">
          Records
        </h2>

        <p className="agentsec__lede">
          The notebook your agent writes in on purpose, and the only thing it
          still has on a scheduled run tomorrow.{" "}
          {on ? (
            <>
              This is not Memory. Memory is what it works out about you on its
              own and forgets when full; these are things it chose to keep, and
              when the store is full it says so rather than dropping the oldest
              one.
            </>
          ) : (
            <>
              Keep Records is switched off, so nothing here can be read or
              written. Turn it on in Capabilities.
            </>
          )}
        </p>
      </div>

      <div className="agentsec__body">
        {!agentId ? (
          <Callout tone="info" title="Save this agent first">
            Records are stored against a saved agent, not a draft — that is what
            keeps one agent's notebook separate from another's. Save it, then
            ask it to remember something in the Test panel.
          </Callout>
        ) : !on ? (
          <Callout tone="caution" title="Keep Records is off">
            Your agent cannot read or write any of this while the capability is
            off. Anything it saved before is kept below and is not being used —
            delete it here if you would rather it were gone.
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button variant="secondary" size="sm" onClick={onOpenCapabilities}>
                Open Capabilities
              </Button>
            </div>
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="error" title="Could not read this agent's records">
            {error}
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
                icon={<RefreshCw size={14} />}
              >
                Try again
              </Button>
            </div>
          </Callout>
        ) : null}

        {agentId && !records && !error ? (
          <p className="agentsec__note">
            <Loader2 size={14} className="spin" aria-hidden="true" /> Reading
            what this agent has saved…
          </p>
        ) : null}

        {agentId && records && usage ? (
          <div className="memories">
            <div className="memories__head">
              <Meter
                label="Records kept"
                used={live.length}
                limit={usage.maxRecords}
                unit="records"
              />

              <div className="memories__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refresh()}
                  disabled={busy}
                  icon={<RefreshCw size={14} />}
                >
                  Refresh
                </Button>

                {records.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                    icon={<Trash2 size={14} />}
                  >
                    Delete all
                  </Button>
                ) : null}
              </div>
            </div>

            {live.length === 0 ? (
              <EmptyState
                icon={<Database size={20} />}
                title="Nothing saved yet"
                text={
                  on
                    ? "Ask your agent to keep track of something in the Test panel — a habit, a running total, a number it should still know next week."
                    : "Turn Keep Records on and your agent can start writing things down."
                }
              />
            ) : (
              <ul className="memories__list">
                {live.map((record) => (
                  <Record
                    key={record.id}
                    record={record}
                    busy={busy}
                    onDelete={() =>
                      void act(() => deleteRecord(agentId, record.id))
                    }
                  />
                ))}
              </ul>
            )}

            {/* -----------------------------------------------
                RETIRED

                The second half of the soft delete, and the
                reason it is a soft one. Model output may take a
                record out of circulation; only a person destroys
                it. That rule is a promise nobody can check
                unless the retired ones are on screen with a way
                back.
                ----------------------------------------------- */}
            {retired.length > 0 ? (
              <div className="memories__deployed">
                <div className="memories__head">
                  <div>
                    <h3 className="memories__subtitle">
                      Removed by your agent
                    </h3>
                    <p className="agentsec__note">
                      Your agent no longer uses these and they do not count
                      against its limit. They are kept for a week in case you
                      want one back.
                    </p>
                  </div>
                </div>

                <ul className="memories__list">
                  {retired.map((record) => (
                    <Record
                      key={record.id}
                      record={record}
                      busy={busy}
                      onRestore={() =>
                        void act(() => restoreRecord(agentId, record.id))
                      }
                      onDelete={() =>
                        void act(() => deleteRecord(agentId, record.id))
                      }
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog
        open={confirming}
        title="Delete every record?"
        text="This removes everything your agent has written down, including what it had already removed itself. It cannot be undone, and a scheduled run tomorrow will start from nothing."
        confirmLabel="Delete all"
        destructive
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void act(() => clearRecords(agentId ?? ""));
        }}
      />
    </section>
  );
}

function Record({
  record,
  busy,
  onRestore,
  onDelete,
}: {
  record: StoredRecord;
  busy: boolean;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="memory">
      <div className="memory__main">
        <p className="record__key">{record.key}</p>

        {/*
          The value in full, not a summary.

          The design rule MemorySection states applies here too:
          if the agent knows it, the learner reads it. A record
          may be JSON the agent wrote for itself, which is not
          pretty — and showing it anyway is the point, because
          the alternative is a store whose contents its owner
          has to take on trust.
        */}
        <p className="record__value">{record.value}</p>

        {record.label ? (
          <p className="memory__text record__label">{record.label}</p>
        ) : null}
      </div>

      <div className="memory__meta">
        {onRestore ? (
          <IconButton
            label={`Restore ${record.key}`}
            icon={<RotateCcw size={15} />}
            size="sm"
            disabled={busy}
            onClick={onRestore}
          />
        ) : null}

        <IconButton
          label={`Delete ${record.key}`}
          icon={<Trash2 size={15} />}
          size="sm"
          disabled={busy}
          onClick={onDelete}
        />
      </div>
    </li>
  );
}
