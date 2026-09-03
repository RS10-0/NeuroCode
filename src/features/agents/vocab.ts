/*
 * The closed vocabularies an agent is described in.
 *
 * A leaf module: no imports, and it must stay that way. That is
 * the entire reason it exists as a separate file rather than
 * living in capabilities.ts and types.ts where these two unions
 * were first written.
 *
 * The server reads src/features/agents/flagships.ts directly —
 * the same trick SiteStore uses on src/features/sites/slug.ts,
 * and xpPlan uses on the curriculum — so that BuildGentic's own
 * agents have one definition rather than one per side. That
 * only works while the file it reads has nothing behind it: the
 * server's tsconfig would otherwise have to resolve
 * lucide-react (capabilities.ts imports icons) and
 * src/lib/aiClient (types.ts imports a runtime type), neither
 * of which is the backend's business.
 *
 * So the two unions live here, capabilities.ts and types.ts
 * re-export them unchanged, and every existing importer is
 * untouched.
 */

/*
 * What an agent is allowed to do.
 *
 * Whether a capability is READY — whether the runtime can
 * actually carry it out — is not recorded here. That lives in
 * capabilities.ts beside the label, the blurb and the icon,
 * because it is a fact about this build rather than about the
 * vocabulary.
 */
export type CapabilityId =
  | "chat"
  | "knowledge_retrieval"
  | "web_search"
  | "file_analysis"
  | "code_execution"
  | "memory"
  /*
   * The two action capabilities are separate ids rather than
   * one, and the split is deliberate: they are not the same
   * permission, and an owner should not have to grant both to
   * get one.
   *
   * Running code touches nothing outside a sandbox with no
   * filesystem, no network and no environment. Calling an API
   * spends the owner's credential against somebody else's
   * server and may change something there. An agent that needed
   * a calculator should not become reachable from the open
   * internet as a side effect.
   *
   * `code_execution` was in this union long before either
   * worked, carried as ready:false in capabilities.ts with the
   * note "Needs a sandbox". It now has one.
   */
  | "http_actions"
  /*
   * The two Phase 3 capabilities, and they are separate ids for
   * the same reason the two above are: they are not the same
   * permission.
   *
   * Producing a file that gets emailed to you is not the grant
   * that keeps durable records about you. An owner who wants a
   * weekly PDF should not thereby have given their agent a
   * memory it controls, and one that tracks habits should not
   * thereby be able to mail files. Folding them into a single
   * "advanced" switch would make the smaller ask carry the
   * larger one.
   */
  | "document_generation"
  | "data_store"
  /*
   * THE MAILBOX, IN FOUR IDS, AND THE SPLIT IS THE WHOLE POINT.
   *
   * Every capability above this line is separated from its
   * neighbours because they are not the same permission. That
   * argument has never mattered as much as it does here, and it
   * points in two directions at once.
   *
   * `email_read` is one grant and not two. Searching a mailbox
   * is not a different permission from reading it — an agent
   * that can list an inbox can find any message in it anyway,
   * so a separate `email_search` would be a switch that flips
   * and changes nothing about what the agent can reach. See the
   * rule capabilities.ts opens with: a toggle that changes
   * nothing is worse than no toggle.
   *
   * `email_send` IS separate, from drafting and from everything
   * else, and it is the most consequential id in this union. A
   * student who wants help writing a reply should not have to
   * hand over the ability to deliver one, and folding the two
   * together would make the smaller ask carry the larger.
   *
   * And it is the one capability id in this file that DOES NOT
   * APPEAR IN ActionCapabilityFlags. There is no send tool, so
   * a turn has no way to reach it whether it is on or not; what
   * it gates is whether the Send button on a drafted reply does
   * anything. The gap between this union and that interface is
   * deliberate and is checked by the verification suite.
   */
  | "email_read"
  | "email_draft"
  | "email_send"
  | "email_organize";

/*
 * One of the palette's own tones, for an agent's avatar.
 *
 * Matches the CHECK constraint on agents.avatar_tone in
 * migration 0005.
 */
export type AvatarTone = "accent" | "correct" | "caution" | "error";
