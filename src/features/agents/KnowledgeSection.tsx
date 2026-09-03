import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Callout,
  IconButton,
  Input,
  Textarea,
  type BadgeTone,
} from "../../components/ui";
import { composeSystem } from "./compose";
import {
  FILE_ACCEPT,
  KnowledgeFileError,
  newNote,
  readKnowledgeFile,
} from "./knowledge";
import type {
  KnowledgeEntryState,
  KnowledgeIndexStatus,
} from "./knowledgeIndex";
import type { AgentDraft, KnowledgeEntry } from "./types";

/*
 * What the agent knows that the model does not.
 *
 * This section used to be an argument about a character budget,
 * because the mechanism was the crudest one that works: every
 * entry pasted into the system prompt, in full, on every single
 * turn. A learner added a document, watched the bar move, added
 * another, and discovered for themselves that an agent cannot
 * simply be given everything.
 *
 * That lesson is why the budget meter is still here, and why the
 * capability is still a switch rather than a silent upgrade.
 * Retrieval is the answer to a problem, and a learner who never
 * felt the problem has only been handed a feature. Turning
 * knowledge search off refills the bar in front of them.
 *
 * What the section must NOT become is a lecture on vector
 * search. The sentence a beginner needs is "your agent searches
 * its knowledge and uses the most relevant parts", and the
 * chunk counts, the embedding model and the rest are one
 * disclosure triangle away for whoever wants them.
 */

interface KnowledgeSectionProps {
  draft: AgentDraft;
  knowledge: KnowledgeEntry[];
  systemBudget: number;
  onChange: (entries: KnowledgeEntry[]) => void;
  /*
   * Null until the agent has been saved once and the index has
   * been read. An unsaved draft has no rows to index, which is a
   * state the UI has to be able to say out loud.
   */
  index: KnowledgeIndexStatus | null;
  indexing: boolean;
  indexError: string | null;
  /* Unsaved changes. Knowledge is indexed from the saved rows,
     so an edit on screen is not searchable yet. */
  dirty: boolean;
  onReindex: () => void;
}

/* Coarse on purpose: "3 minutes ago" is more useful here than a
   timestamp nobody reads, and the exact second is not a fact
   anyone needs about an index. */
function agoText(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface Chip {
  tone: BadgeTone;
  label: string;
  /* The sentence under the entry, when there is something worth
     saying beyond the label. */
  note?: string | null;
}

/*
 * One entry's state, in words a beginner can act on.
 *
 * Every label says what is happening to their document rather
 * than what the system did to it. "Searchable · 4 parts" rather
 * than "indexed, 4 chunks", "Sent in full with every message"
 * rather than "inline".
 */
function chipFor(
  entry: KnowledgeEntry,
  state: KnowledgeEntryState | undefined,
  retrievalOn: boolean
): Chip {
  if (!retrievalOn) {
    return {
      tone: "neutral",
      label: "Sent in full",
    };
  }

  if (!entry.content.trim()) {
    return { tone: "neutral", label: "Empty" };
  }

  if (!state) {
    return {
      tone: "neutral",
      label: "Not saved yet",
      note: "Save this agent and it will be made searchable.",
    };
  }

  switch (state.state) {
    case "indexed":
      return state.chunkCount > 0
        ? {
            tone: "correct",
            label: `Searchable · ${state.chunkCount} part${
              state.chunkCount === 1 ? "" : "s"
            }`,
            note: state.indexedAt ? `Searched from ${agoText(state.indexedAt)}` : null,
          }
        : { tone: "neutral", label: "Empty" };

    case "indexing":
      return { tone: "accent", label: "Reading it now…" };

    case "failed":
      return {
        tone: "error",
        label: "Could not be searched",
        note: state.error
          ? `${state.error} It is still being sent in full with every message, so your agent has not lost it.`
          : null,
      };

    case "unsupported":
      return {
        tone: "caution",
        label: "Search unavailable",
        note: state.error,
      };

    default:
      return {
        tone: "caution",
        label: "Waiting to be searched",
        note: "Still sent in full with every message until then.",
      };
  }
}

export default function KnowledgeSection({
  draft,
  knowledge,
  systemBudget,
  onChange,
  index,
  indexing,
  indexError,
  dirty,
  onReindex,
}: KnowledgeSectionProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const retrievalOn = draft.capabilities.includes("knowledge_retrieval");

  const composed = composeSystem(draft, knowledge, systemBudget);

  const ratio = composed.budget > 0 ? composed.totalChars / composed.budget : 0;

  const countClass =
    composed.overBy > 0
      ? "knowledge__budget-count knowledge__budget-count--over"
      : ratio >= 0.85
        ? "knowledge__budget-count knowledge__budget-count--near"
        : "knowledge__budget-count";

  const overflowing = composed.entries.filter((entry) => !entry.fits);

  const states = new Map(
    (index?.entries ?? []).map((entry) => [entry.knowledgeId, entry])
  );

  const searchable = (index?.entries ?? []).filter(
    (entry) => entry.state === "indexed" && entry.chunkCount > 0
  );

  const withContent = knowledge.filter((entry) => entry.content.trim());

  function patchEntry(id: string, patch: Partial<KnowledgeEntry>) {
    onChange(
      knowledge.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      )
    );
  }

  function remove(id: string) {
    onChange(knowledge.filter((entry) => entry.id !== id));
  }

  function move(index_: number, by: number) {
    const next = [...knowledge];
    const target = index_ + by;

    if (target < 0 || target >= next.length) {
      return;
    }

    [next[index_], next[target]] = [next[target], next[index_]];
    onChange(next);
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setFileError(null);

    const added: KnowledgeEntry[] = [];
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      try {
        added.push(await readKnowledgeFile(file));
      } catch (error) {
        failures.push(
          error instanceof KnowledgeFileError
            ? error.message
            : `${file.name} could not be read.`
        );
      }
    }

    if (added.length > 0) {
      onChange([...knowledge, ...added]);
    }

    if (failures.length > 0) {
      setFileError(failures.join(" "));
    }
  }

  return (
    <section className="agentsec" aria-labelledby="agentsec-knowledge">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-knowledge">
          Knowledge
        </h2>

        <p className="agentsec__lede">
          Material your agent can draw on that the model was never trained on —
          your notes, your syllabus, your rules.{" "}
          {retrievalOn ? (
            <>
              Your agent searches this for every question and uses only the
              parts that match, so you can give it far more than would fit in
              one message.
            </>
          ) : (
            <>
              With knowledge search switched off, every entry is sent in full
              with every message — so the budget below is a real constraint
              rather than a formality.
            </>
          )}
        </p>
      </div>

      <div className="agentsec__body">
        <div className="knowledge">
          {/* ---------------------------------------------------------
              SEARCH

              The status panel, and the one place the technical
              account of what is happening is available — behind
              a disclosure triangle, because a beginner needs the
              sentence above it and nothing else.
              --------------------------------------------------------- */}

          {retrievalOn ? (
            <div className="ksearch">
              <div className="ksearch__head">
                <span className="ksearch__icon" aria-hidden="true">
                  <Search size={15} />
                </span>

                <span className="ksearch__summary">
                  <strong>Knowledge search is on.</strong>{" "}
                  {index === null ? (
                    <>Save this agent to make its knowledge searchable.</>
                  ) : indexing ? (
                    <>Reading your knowledge so it can be searched…</>
                  ) : searchable.length > 0 ? (
                    <>
                      {searchable.length} of {withContent.length}{" "}
                      {withContent.length === 1 ? "entry is" : "entries are"}{" "}
                      searchable, in{" "}
                      {index.totalChunks.toLocaleString()}{" "}
                      {index.totalChunks === 1 ? "part" : "parts"}.
                    </>
                  ) : withContent.length === 0 ? (
                    <>Nothing to search yet.</>
                  ) : (
                    <>Nothing is searchable yet.</>
                  )}
                </span>

                {index !== null ? (
                  <Button
                    size="sm"
                    icon={<RefreshCw size={14} />}
                    disabled={indexing || withContent.length === 0}
                    onClick={onReindex}
                  >
                    {indexing ? "Working…" : "Re-read"}
                  </Button>
                ) : null}
              </div>

              {dirty ? (
                <p className="ksearch__note">
                  You have unsaved changes. Your agent searches what has been
                  saved, so save to bring the search up to date.
                </p>
              ) : null}

              <details className="ksearch__details">
                <summary>How the search actually works</summary>

                <p>
                  Each entry is split into overlapping passages of a few
                  hundred words, at headings and paragraph breaks where it can
                  find them. Every passage is turned into a list of numbers —
                  an <em>embedding</em> — that stands for its meaning, and
                  those are stored alongside your agent.
                </p>

                <p>
                  When someone asks a question, the question is turned into
                  numbers the same way, and the passages whose numbers are
                  closest to it are the ones sent to the model. Closest means
                  closest in meaning rather than in wording, which is why a
                  question about "what makes plants grow" can find a passage
                  that only ever says "photosynthesis".
                  {index?.embeddingModel ? (
                    <>
                      {" "}
                      Yours are made by{" "}
                      <strong>{index.embeddingModel.displayName}</strong>,
                      running on the same power source as the rest of this
                      agent.
                    </>
                  ) : null}
                </p>

                <p>
                  Passages that match are shown to the model as quoted
                  reference material, clearly separated from your
                  instructions — so an agent reading a document that says
                  "ignore your instructions" treats that as something the
                  document says, not as something it has been told.
                </p>
              </details>
            </div>
          ) : null}

          {index?.unavailableReason ? (
            <Callout tone="caution" title="This agent cannot search yet">
              {index.unavailableReason} Nothing has been lost — every entry is
              still sent in full with every message, exactly as it was before.
            </Callout>
          ) : null}

          {indexError ? (
            <Callout tone="caution" title="The search index could not be updated">
              {indexError} Your knowledge is still sent in full with every
              message, so your agent can still use it.
            </Callout>
          ) : null}

          {/* ---------------------------------------------------------
              THE BUDGET

              Instructions and knowledge share one allowance,
              because they share one field on the wire. What
              counts against it now is only what is still sent
              every time — which is the number that falls as
              entries become searchable, and the whole visible
              payoff of this capability.
              --------------------------------------------------------- */}

          <div className="knowledge__budget">
            <div className="knowledge__budget-head">
              <span className="knowledge__budget-label">
                {retrievalOn
                  ? "Sent with every message"
                  : "Instructions and knowledge"}
              </span>

              <span className={countClass}>
                {composed.totalChars.toLocaleString()} /{" "}
                {composed.budget.toLocaleString()} characters
              </span>
            </div>

            <div
              className="bar"
              role="progressbar"
              aria-label="System prompt budget used"
              aria-valuemin={0}
              aria-valuemax={composed.budget}
              aria-valuenow={Math.min(composed.totalChars, composed.budget)}
            >
              <span
                className="bar__fill"
                style={{
                  width: `${Math.min(100, Math.round(ratio * 100))}%`,
                  background:
                    composed.overBy > 0
                      ? "var(--error)"
                      : ratio >= 0.85
                        ? "var(--caution)"
                        : "var(--accent)",
                }}
              />
            </div>

            <p className="agentsec__note" style={{ marginTop: "var(--space-3)" }}>
              {composed.instructionChars.toLocaleString()} characters of
              instructions, {composed.knowledgeChars.toLocaleString()} of
              knowledge.{" "}
              {retrievalOn ? (
                <>
                  Searchable entries are not counted here — they are looked up
                  per question instead, which is why this bar stops filling as
                  you add more.
                </>
              ) : (
                <>Every message your agent answers carries all of it.</>
              )}
            </p>
          </div>

          {composed.overBy > 0 ? (
            <Callout tone="error" title="Too much to send">
              This is {composed.overBy.toLocaleString()} characters over what
              the model can be given in one go, so the agent cannot answer
              until something is removed.{" "}
              {overflowing.length > 0 ? (
                <>
                  The{" "}
                  {overflowing.length === 1
                    ? "entry that does not fit is"
                    : `${overflowing.length} entries that do not fit start with`}{" "}
                  <strong>{overflowing[0].title}</strong>.{" "}
                </>
              ) : null}
              Nothing is trimmed automatically — an agent answering from half a
              document, with no way to tell which half, is worse than one that
              says it cannot.{" "}
              {retrievalOn ? (
                <>
                  Everything here is still waiting to be made searchable; once
                  it is, it stops counting against this limit.
                </>
              ) : (
                <>
                  Switching on knowledge search, in Capabilities, is how this
                  limit stops mattering: it sends only the parts that match a
                  question.
                </>
              )}
            </Callout>
          ) : null}

          {/* ---------------------------------------------------------
              THE ENTRIES
              --------------------------------------------------------- */}

          {knowledge.length === 0 ? (
            <p className="agentsec__note">
              Nothing yet. An agent with no knowledge still works — it just
              answers from what the model already knew, which is exactly what
              the Lab does.
            </p>
          ) : (
            <ul className="knowledge__list">
              {knowledge.map((entry, position) => {
                const measured = composed.entries.find(
                  (item) => item.id === entry.id
                );

                const chip = chipFor(entry, states.get(entry.id), retrievalOn);

                return (
                  <li
                    key={entry.id}
                    className={
                      measured && !measured.fits ? "kentry kentry--over" : "kentry"
                    }
                  >
                    <div className="kentry__head">
                      <span className="kentry__icon">
                        {entry.kind === "file" ? (
                          <FileText size={15} aria-hidden="true" />
                        ) : (
                          <StickyNote size={15} aria-hidden="true" />
                        )}
                      </span>

                      <span className="kentry__title">
                        <label className="sr-only" htmlFor={`ktitle-${entry.id}`}>
                          Title of knowledge entry {position + 1}
                        </label>

                        <Input
                          id={`ktitle-${entry.id}`}
                          value={entry.title}
                          placeholder="Untitled"
                          maxLength={120}
                          onChange={(event) =>
                            patchEntry(entry.id, { title: event.target.value })
                          }
                        />
                      </span>

                      <span className="kentry__meta">
                        <Badge tone={chip.tone}>{chip.label}</Badge>

                        <span className="kentry__chars">
                          {entry.content.length.toLocaleString()}
                        </span>

                        <IconButton
                          label={`Move ${entry.title || "entry"} up`}
                          icon={<ChevronUp size={15} />}
                          size="sm"
                          disabled={position === 0}
                          onClick={() => move(position, -1)}
                        />

                        <IconButton
                          label={`Move ${entry.title || "entry"} down`}
                          icon={<ChevronDown size={15} />}
                          size="sm"
                          disabled={position === knowledge.length - 1}
                          onClick={() => move(position, 1)}
                        />

                        <IconButton
                          label={`Remove ${entry.title || "entry"}`}
                          icon={<Trash2 size={15} />}
                          size="sm"
                          onClick={() => remove(entry.id)}
                        />
                      </span>
                    </div>

                    <div className="kentry__body">
                      <label className="sr-only" htmlFor={`kbody-${entry.id}`}>
                        Content of knowledge entry {position + 1}
                      </label>

                      <Textarea
                        id={`kbody-${entry.id}`}
                        rows={entry.kind === "file" ? 4 : 6}
                        value={entry.content}
                        placeholder="Paste or type what the agent should know."
                        onChange={(event) =>
                          patchEntry(entry.id, { content: event.target.value })
                        }
                      />

                      {chip.note ? (
                        <p className="kentry__state">{chip.note}</p>
                      ) : null}

                      {entry.sourceName ? (
                        <p className="kentry__source">
                          <Paperclip size={12} aria-hidden="true" />
                          From {entry.sourceName}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {fileError ? (
            <Callout tone="caution" title="Some files were not added">
              {fileError}
            </Callout>
          ) : null}

          <div className="knowledge__add">
            <Button
              icon={<Plus size={15} />}
              onClick={() => onChange([...knowledge, newNote(knowledge.length)])}
            >
              Add a note
            </Button>

            <Button
              icon={<Paperclip size={15} />}
              onClick={() => fileRef.current?.click()}
            >
              Add a text file
            </Button>

            {/* Never submitted anywhere. The file is read in this
                tab and only its text is kept, which is why this
                project still has no storage bucket. */}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept={FILE_ACCEPT}
              multiple
              onChange={(event) => {
                void addFiles(event.target.files);
                /* Cleared so picking the same file twice fires a
                   change event the second time. */
                event.target.value = "";
              }}
            />
          </div>

          <p className="agentsec__note">
            Plain text only for now — .txt, .md, .csv, .json. A PDF is a
            container, not text, and reading its raw bytes into a prompt would
            give your agent gibberish rather than your document. Files are read
            here in your browser and never uploaded.
          </p>
        </div>
      </div>
    </section>
  );
}
