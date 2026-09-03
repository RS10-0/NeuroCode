import type { AiRuntimeInfo } from "../../lib/aiClient";
import { normalizeCapabilities, type CapabilityId } from "./capabilities";
import { findFlagship } from "./flagships";
import type { AvatarTone } from "./vocab";

/*
 * What an agent is, in the browser.
 *
 * The important sentence, and the one the whole feature is built
 * around: an agent is a saved configuration, not a runtime. It
 * names a model and a power source that the Phase 2.1 runtime
 * already knows how to reach, adds standing instructions and a
 * body of knowledge, and that is the entire difference between
 * an agent and a Lab run. Nothing in this file holds a provider,
 * a key or a URL, for the same reason nothing in the Lab does.
 *
 * `AgentDraft` is what the Builder edits; `Agent` is a draft that
 * has been saved and therefore has an id and timestamps. Keeping
 * them separate is what lets the Test panel run a configuration
 * that has never been written to the database — which it has to,
 * because the order a learner works in is configure, test, then
 * save.
 */

/* Defined in ./vocab, a leaf module the server can read. See
   vocab.ts for why it is not declared here. */
export type { AvatarTone } from "./vocab";
export type AgentStatus = "draft" | "ready";
export type KnowledgeKind = "text" | "file";

/*
 * How a knowledge entry reaches the model.
 *
 *   inline  — pasted into the system prompt on every turn, in
 *             full. What every entry does before it has been
 *             indexed, and what every entry falls back to if
 *             indexing fails.
 *   indexed — chunked and embedded; the matching parts arrive
 *             per question instead. Both composers skip these,
 *             so an indexed entry is never sent twice.
 *   error   — could not be read. Kept, so the learner can see
 *             what happened rather than watching a row vanish.
 *
 * Server-owned since Phase 2.5. The browser reads it to know
 * what an entry is doing and never writes it — see the note in
 * `knowledgeToRow`.
 */
export type KnowledgeStatus = "inline" | "indexed" | "error";

export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  /* The file it came from. Null for pasted text. */
  sourceName: string | null;
  charCount: number;
  position: number;
  status: KnowledgeStatus;
}

export interface AgentDraft {
  name: string;
  description: string;
  avatarEmoji: string;
  avatarTone: AvatarTone;
  instructions: string;
  /*
   * Always BuildGentic's one public model id.
   *
   * Kept on the row rather than dropped because the column is
   * still there and still not-null, and because an agent saved
   * today should still say which AI it was built against if the
   * catalogue ever grows a second entry. Nobody picks it.
   */
  model: string;
  temperature: number;
  maxOutputTokens: number;
  capabilities: CapabilityId[];
  status: AgentStatus;
}

export interface Agent extends AgentDraft {
  id: string;
  /*
   * One of BuildGentic's own agents, unlocked from the Library.
   *
   * Not on AgentDraft, and that is deliberate: a draft is what
   * the Builder edits, and an official agent is not editable.
   * Keeping the flag off the draft means there is no form state
   * that could ever try to set it — the database refuses it
   * too, in the WITH CHECK added by migration 0015, but a shape
   * that cannot express the write is the cheaper guarantee.
   */
  isOfficial: boolean;
  flagshipId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* =========================================================
   AVATARS

   A glyph and one of the palette's own tones. Deliberately not
   an upload: there is no storage bucket in this project, and
   adding one — with its own policies and its own failure modes —
   to decorate a card would be a strange place to spend the
   phase's budget.
========================================================= */

export const AVATAR_GLYPHS: string[] = [
  "🤖",
  "📚",
  "🧭",
  "⚗️",
  "🛠️",
  "💬",
  "🔎",
  "✍️",
  "🧮",
  "🌱",
  "🎓",
  "🗺️",
];

export const AVATAR_TONES: Array<{ id: AvatarTone; label: string }> = [
  { id: "accent", label: "Blue" },
  { id: "correct", label: "Green" },
  { id: "caution", label: "Amber" },
  { id: "error", label: "Red" },
];

/* =========================================================
   DATABASE ROWS

   snake_case mirrors of the two tables, kept beside the app
   types so a column rename has one obvious place to land. The
   Supabase client is untyped in this project, so these are the
   only description of the wire shape there is.
========================================================= */

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  avatar_emoji: string;
  avatar_tone: string;
  system_instructions: string;
  model: string;
  /* numeric(3,2). PostgREST sends it as a JSON number, but it is
     coerced on the way in rather than trusted to stay one. */
  temperature: number | string;
  max_output_tokens: number;
  capabilities: string[] | null;
  status: string;
  is_official: boolean | null;
  flagship_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentKnowledgeRow {
  id: string;
  agent_id: string;
  user_id: string;
  kind: string;
  title: string;
  content: string;
  source_name: string | null;
  char_count: number;
  position: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export const AGENT_COLUMNS =
  "id, user_id, name, description, avatar_emoji, avatar_tone, system_instructions, model, temperature, max_output_tokens, capabilities, status, is_official, flagship_id, created_at, updated_at";

export const KNOWLEDGE_COLUMNS =
  "id, agent_id, user_id, kind, title, content, source_name, char_count, position, status, created_at, updated_at";

/* =========================================================
   MAPPERS

   Defensive in one direction only. Reading is where a row
   written by an older build, a newer build or the SQL editor
   arrives, so every constrained field is normalised on the way
   in; writing goes through the app's own types and needs no
   such guard.
========================================================= */

function asTone(value: unknown): AvatarTone {
  return value === "correct" || value === "caution" || value === "error"
    ? value
    : "accent";
}

function asStatus(value: unknown): AgentStatus {
  return value === "ready" ? "ready" : "draft";
}

function asKnowledgeStatus(value: unknown): KnowledgeStatus {
  return value === "indexed" || value === "error" ? value : "inline";
}

export function rowToAgent(row: AgentRow): Agent {
  /*
   * `instructions` is EMPTY for an official agent, and that is
   * correct rather than a gap.
   *
   * BuildGentic's own prompts live server-side in
   * server/src/agents/flagshipPrompts.ts and are resolved onto
   * the record there, on every read, because the prompt is what
   * a learner paid up to 200 XP for — sending it to the browser
   * would let anybody paste it into a free agent.
   *
   * So nothing in this tab can display an official agent's
   * instructions. The Builder shows a locked panel rather than
   * a disabled textarea, which is the honest rendering of "this
   * is managed by BuildGentic" anyway.
   *
   * `capabilities` IS resolved here, and it is the one field on
   * an official agent that does not come from the row.
   *
   * The argument is the server's — see the long note in
   * server/src/agents/AgentStore.ts, which is the authority and
   * where the reasoning lives rather than being restated twice.
   * The short version is that migration 0015 makes an official
   * agent's row unwritable by its owner, so a capability list
   * copied at purchase time can never be changed again by
   * anything a learner can reach.
   *
   * This side matters for a specific reason the server's does
   * not: compose.ts reads THIS list to decide which capability
   * flags the Test panel sends. Resolving on the server alone
   * would give a learner an agent the runtime would let export
   * a file, being asked not to by their own browser.
   *
   * Still through `normalizeCapabilities`, so a catalogue entry
   * naming something this build cannot honour is dropped here
   * exactly as a stored row's would be. The rule that a toggle
   * never claims what the runtime will not do does not get an
   * exemption for being ours.
   */
  const official =
    row.is_official === true ? findFlagship(row.flagship_id) : undefined;

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    avatarEmoji: row.avatar_emoji || AVATAR_GLYPHS[0],
    avatarTone: asTone(row.avatar_tone),
    instructions: row.system_instructions ?? "",
    model: row.model,
    temperature: Number(row.temperature),
    maxOutputTokens: Number(row.max_output_tokens),
    capabilities: normalizeCapabilities(
      official ? official.capabilities : row.capabilities
    ),
    status: asStatus(row.status),
    isOfficial: row.is_official === true,
    flagshipId: row.flagship_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/*
 * The write payload, minus the id.
 *
 * `updated_at` is set here rather than by a trigger because
 * there are no triggers in this schema — every other store in
 * the project stamps it from TS, and one table quietly doing it
 * differently is how "why is this row's timestamp wrong" starts.
 */
export function draftToRow(
  draft: AgentDraft,
  userId: string
): Omit<AgentRow, "id" | "created_at" | "is_official" | "flagship_id"> {
  return {
    user_id: userId,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    avatar_emoji: draft.avatarEmoji,
    avatar_tone: draft.avatarTone,
    system_instructions: draft.instructions,
    model: draft.model,
    temperature: draft.temperature,
    max_output_tokens: draft.maxOutputTokens,
    capabilities: draft.capabilities,
    status: draft.status,
    updated_at: new Date().toISOString(),
  };
}

export function rowToKnowledge(row: AgentKnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    kind: row.kind === "file" ? "file" : "text",
    title: row.title,
    content: row.content,
    sourceName: row.source_name,
    charCount: Number(row.char_count),
    position: Number(row.position),
    status: asKnowledgeStatus(row.status),
  };
}

export interface KnowledgeWriteRow {
  id: string;
  agent_id: string;
  user_id: string;
  kind: string;
  title: string;
  content: string;
  source_name: string | null;
  char_count: number;
  position: number;
  updated_at: string;
}

export function knowledgeToRow(
  entry: KnowledgeEntry,
  agentId: string,
  userId: string
): KnowledgeWriteRow {
  return {
    id: entry.id,
    agent_id: agentId,
    user_id: userId,
    kind: entry.kind,
    title: entry.title.trim(),
    content: entry.content,
    source_name: entry.sourceName,
    /* Recomputed rather than trusted, so the denormalised count
       cannot drift from the text it describes. */
    char_count: entry.content.length,
    position: entry.position,
    /*
     * `status` is deliberately absent, and its absence is what
     * keeps retrieval honest.
     *
     * The column says whether an entry is searchable yet, which
     * is a conclusion the server reached by actually embedding
     * it. This upsert carries the whole row, so including the
     * status would reset a freshly indexed entry to `inline`
     * every time a learner fixed a typo in an unrelated note —
     * and the agent would quietly go back to pasting a library
     * into every prompt.
     *
     * Omitted from the payload means PostgREST leaves it alone
     * on an update and takes the table's default on an insert,
     * which is `inline`. A brand-new entry is therefore inlined
     * from the moment it is saved until the index run that
     * follows finishes, which is exactly right: it reaches the
     * model either way, and never through both routes at once.
     */
    updated_at: new Date().toISOString(),
  };
}

/* =========================================================
   DRAFTS
========================================================= */

/*
 * A new agent, opened at the server's own defaults.
 *
 * Model, temperature and the output cap come from the catalogue
 * the server just published rather than from constants here, for
 * the same reason the Lab's `initialSettings` does it: a learner
 * who changes nothing and presses Send should get exactly what
 * the runtime would have done on its own, and the controls
 * should agree with it. A number hardcoded in the browser
 * disagrees with the server the first time either default moves.
 */
export function newDraft(info: AiRuntimeInfo): AgentDraft {
  const model =
    info.models.find((entry) => entry.id === info.defaultModel) ??
    info.models[0];

  return {
    name: "",
    description: "",
    avatarEmoji: AVATAR_GLYPHS[0],
    avatarTone: "accent",
    instructions: "",
    model: model?.id ?? "",
    temperature: model?.defaultTemperature ?? 0.7,
    maxOutputTokens: model?.defaultMaxOutputTokens ?? 512,
    /*
     * Knowledge search is on from the start. It is how knowledge
     * works now rather than an optional extra, and an agent
     * whose first document silently filled a character budget
     * would be teaching a problem that has already been solved.
     * It remains a switch, because turning it off and watching
     * the budget meter refill is the clearest possible
     * demonstration of what it does.
     */
    capabilities: ["chat", "knowledge_retrieval"],
    status: "draft",
  };
}

export function agentToDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    avatarEmoji: agent.avatarEmoji,
    avatarTone: agent.avatarTone,
    instructions: agent.instructions,
    model: agent.model,
    temperature: agent.temperature,
    maxOutputTokens: agent.maxOutputTokens,
    capabilities: agent.capabilities,
    status: agent.status,
  };
}

/*
 * What "unsaved changes" is measured against.
 *
 * A string rather than a deep comparison because it is compared
 * on every keystroke and the objects are small. Knowledge is
 * folded in because moving an entry is as much of a change as
 * retyping the instructions.
 *
 * `status` is deliberately absent. It is server-owned since
 * Phase 2.5 — the browser neither writes it nor could save it —
 * so an entry becoming searchable is not a change the learner
 * made and must not light up the Save bar. It used to be in
 * here, and the moment indexing started writing that column it
 * meant every agent looked unsaved a second after being saved.
 */
export function fingerprint(
  draft: AgentDraft,
  knowledge: KnowledgeEntry[]
): string {
  return JSON.stringify([
    draft,
    knowledge.map((entry) => [
      entry.id,
      entry.title,
      entry.content,
      entry.position,
    ]),
  ]);
}

/*
 * A stable id for a knowledge entry that has not been saved yet.
 *
 * `crypto.randomUUID` is unavailable outside a secure context —
 * which includes a dev server reached over a LAN address — so
 * the fallback is not theoretical. The Lab's run ids carry the
 * same guard.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const hex = (length: number) => {
    let out = "";

    while (out.length < length) {
      out += Math.floor(Math.random() * 16).toString(16);
    }

    return out;
  };

  return [hex(8), hex(4), "4" + hex(3), "a" + hex(3), hex(12)].join("-");
}
