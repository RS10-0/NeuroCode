/*
 * Whose records these are.
 *
 * Small, and the whole ownership model, so it is worth reading
 * before anything else in this directory — the same note
 * memory/scope.ts opens with, because this is deliberately the
 * same shape.
 *
 * The store is `User -> Agent -> Records`, never
 * `User -> Records`. A learner's Habit Tracker and their Essay
 * Coach do not share a store, for the reason Memory does not
 * share one: an agent that inherits everything its owner ever
 * kept anywhere is not a more capable agent, it is a privacy
 * failure that also answers worse, because most of what it
 * "knows" is about something else.
 *
 * WHAT IS DIFFERENT FROM MEMORY, and it is the reason this
 * build has only one kind of scope:
 *
 * A memory is written by the SERVER'S OWN INFERENCE. MemoryStore
 * says it plainly — there is no path by which a request body
 * becomes a memory. That is what makes a deployment-scoped
 * memory drawer safe: a stranger talking to a deployed agent
 * cannot choose what is written about them, only cause an
 * extraction call to run.
 *
 * A record here is written by the MODEL, on purpose, because it
 * decided to. Extending that to strangers' turns is a bigger
 * step than extending an inference to them, and it is one to
 * take deliberately rather than by default. So
 * `documentGeneration` and `dataStore` are both refused on the
 * deployment and published-page doors, and the only scope this
 * build constructs is `owner`.
 *
 * The deployment shape is still here, and `scope_key` is still
 * generated in the database exactly as 0010 generates it,
 * because that makes opening the drawer later a VALUE rather
 * than a migration. A design that has to be rebuilt to add a
 * case it already anticipated was not anticipating it.
 */

export type DataScope =
  | {
      kind: "owner";
      /* The learner. Also the row's `user_id`, the RLS
         predicate, and who pays for the turn that wrote it. */
      userId: string;
      agentId: string;
    }
  | {
      /* Constructed by nothing in this build. See above. */
      kind: "deployment";
      deploymentId: string;
      agentId: string;
      ownerId: string;
      /* Already hashed, exactly as memory's subject is. */
      subject: string;
    };

/*
 * The owner of the rows this scope reads and writes.
 *
 * Always a real learner, whichever side is talking. Used as the
 * `user_id` predicate on every query in DataStore which —
 * because the service-role client bypasses RLS — is one of the
 * three things standing between one learner and another's.
 */
export function ownerOf(scope: DataScope): string {
  return scope.kind === "owner" ? scope.userId : scope.ownerId;
}

/*
 * The namespace string, matching the generated `scope_key`
 * column in migration 0018.
 *
 * MUST STAY IDENTICAL TO THE SQL. The column is computed by the
 * database and this function is what every query filters on, so
 * a disagreement between them does not produce an error — it
 * produces an agent that writes records it can never read back,
 * which looks exactly like the feature not working. The verify
 * suite round-trips a written row to prove they agree, which is
 * the check 0010 earned the hard way.
 *
 * The owner half is namespaced by the owner's user id rather
 * than by a constant, for the reason memory/scope.ts gives: a
 * constant would give every learner on the platform the same
 * scope key, and a query that filtered on scope alone would
 * then be a cross-tenant read. It would not actually leak,
 * because the other two predicates are always applied — but a
 * key that is only safe because of the predicates around it is
 * a key waiting for somebody to drop a predicate.
 */
export function scopeKeyOf(scope: DataScope): string {
  return scope.kind === "owner"
    ? `${scope.userId}:`
    : `${scope.deploymentId}:${scope.subject}`;
}

/* The agent, which is the predicate the whole ownership model
   rests on: one of a learner's agents cannot read another of
   their own. */
export function agentOf(scope: DataScope): string {
  return scope.agentId;
}
