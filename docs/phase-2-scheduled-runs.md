# Phase 2 — Scheduled agent runs

**Status:** built and verified. This document is now the record of
*why* it is shaped this way, not a proposal.
**Depends on:** Phase 1 (code execution + `http_actions`, the mid-turn tool loop), complete and verified.
**Migration:** 0017, written and applied.

**What proves it:**

| | |
|---|---|
| `scripts/verify-schedules.mts` | 51 passed, 0 failed — cadence and DST arithmetic, the confabulation classifier, the frequency floor |
| `scripts/verify-schedules-e2e.mts` | 57 passed, 0 failed — live database and live model: the preview gate, the per-user cap, concurrent claims, a real scheduled run, the breaker, notifications, the XP reserve |
| `scripts/verify-actions.mts` | 90 passed, 0 failed — Phase 1 unaffected |
| the ticker | seeded a schedule due 30s ago; the in-process timer claimed and ran it unattended after ~45s, `outcome=succeeded` |
| browser | the whole flow driven for real — create, preview run against a live model, the gate locking the switch, the feed popover, the dashboard digest; console and network clean at 375px and 1280px |

**Two decisions changed during the build**, both because a test caught
them and both recorded where they happened:

- The six-hour floor governs how often a schedule **repeats**, not how
  soon its next run may be. Applying it to the clock-anchored cadences
  made a daily 09:00 schedule enabled at 08:00 fire at 14:00 on its
  first day — the one day its owner is watching. See §6.5 and
  `cadence.ts`.
- The claim pattern gained an `if`/`unless` lookbehind, so *"If I ran
  it, the answer would depend on the input"* is no longer flagged. That
  sentence is exactly what an honest agent writes when it has no tool,
  and punishing it would punish the behaviour the prompt asks for. The
  change only ever removes matches; every measured claim shape is still
  asserted. See §3.2 and `confabulation.ts`.

---

## What this adds

A student can point an agent at a fixed task and a cadence, and BuildGentic runs
that task on its own — no browser open, no Test panel, nobody watching.

The interesting part is not the timer. It is that every property Phase 1 spent
its effort on is a property somebody was *there* to observe. A learner watching
the Test panel sees the step list, sees a tool fail, sees the answer arrive and
notices if it is nonsense. Remove the learner and each of those becomes a thing
the system has to assert on its own, in a row, after the fact.

So this design is mostly about four questions:

1. What wakes the run up. (§1)
2. Why it is the same loop and not a second one. (§2)
3. How a run that lied gets caught by something other than a human reading it. (§3, §4)
4. What it costs, and what stops it costing more. (§6)

---

## 0. The constraint that decides most of this

The action loop cannot move. `sandbox/runJs.ts` spawns a Node child process with
`--max-old-space-size` and a kill timer; `http/addresses.ts` resolves DNS and
checks every resolved address against the private ranges before a socket opens.
Neither of those exists in Postgres, and neither exists in a Supabase Edge
Function — Deno has no `child_process`, and re-implementing the SSRF guard in a
second runtime is precisely the thing this codebase has refused to do six times
running.

**A scheduled run therefore executes in the Express API process.** That is not
a preference, it is the only place the guarantees hold. Everything below follows
from it.

---

## 1. Trigger mechanism

### 1.1 pg_cron, evaluated

We are on Supabase, so `pg_cron` is available and the question deserves a real
answer rather than a shrug.

`pg_cron` runs SQL on a timer, inside the database. It cannot run the loop (§0).
To reach Express it needs `pg_net`, which makes fire-and-forget HTTP calls from
Postgres. That combination is the standard Supabase answer and it is wrong here,
for five reasons, roughly in order of how much they would hurt:

**It puts a plaintext credential in the database with no excuse for it.**
The Express endpoint it POSTs to has to be authenticated, and the only place a
`pg_cron` job can hold a token is its own SQL body — readable by anyone with SQL
Editor access, which in this project is how *every migration is applied*.
Migration 0016 stores a recoverable secret in the database and spends thirty
lines justifying it: the secret must be sent to somebody else's server, so it
must be readable, so the key that opens it lives in the environment instead.
A scheduler token has no such argument. It would be a bare credential sitting in
`cron.job.command`.

**pg_net cannot tell you it failed.** Responses land in `net._http_response` and
nothing reads them unless more SQL is written to. A scheduled run that never
fired because the API was mid-deploy would be invisible on both sides — the
database thinks it dispatched, the API never saw it, and the student's schedule
silently has a hole in it. We would end up building failure tracking anyway,
twice, in two languages.

**The database has no back-pressure.** `pg_net` will happily POST into a void
while the API restarts, and will do it again a minute later. At-least-once
delivery with no way to observe delivery is how an outage becomes a burst.

**A fresh clone stops being runnable.** `pg_net` cannot reach
`http://localhost:3001`. This project's stated and defended property is that a
clone with no keys at all runs the whole stack against the mock provider —
that is what the verification suites depend on. A trigger that only exists in
the hosted project means scheduling can never be exercised locally, and
`verify-schedules.mts` could not be written.

**It is production behaviour that lives outside the repo.** Migrations here are
applied by hand. A cron job defined in the SQL Editor is a piece of live wiring
with no deploy path, which will eventually point at an endpoint that got renamed
three commits ago and fail in the way described two paragraphs up.

**Where `pg_cron` is genuinely right:** as a *maintenance* timer that never
leaves the database — sweeping run rows past their retention window. No HTTP, no
secret, no second language. That use is optional and noted in §7.6; the
retention sweep is written to work without it.

### 1.2 What to build instead

Make the timing source trivial and swappable, and put the correctness somewhere
else entirely.

```
                 ┌─ internal ticker (default)  setInterval(60s).unref()
   a "tick" ─────┤
                 └─ POST /internal/scheduler/tick   (bearer, env token)
                                │
                                ▼
                    runDueSchedules(limit)
                                │
                                ▼
                 agent_schedule_claim(p_limit, p_lease_seconds)   ← the actual guarantee
                                │
                                ▼
                    for each claimed row:  runScheduled()
```

**Default: an in-process ticker.** Started from `server/src/index.ts`, gated by
`NEUROLINK_SCHEDULER` (`internal` | `external` | `off`), `.unref()`d so it never
holds the event loop open, and `off` in the verify scripts.

This does not contradict `FileStore.ts`'s "no timer, deliberately" note. That
note is about a *module* whose import silently starts a timer, which turns a
clean shutdown into a hang and gives every test that touches it a teardown it
should not need. The scheduler is a process-level service started explicitly,
once, from the entrypoint, and it is the one thing here that cannot use the
lazy alternative: FileStore sweeps on write because the only way entries
accumulate is by being added, and a schedule that fires only when somebody
happens to use the app is not a schedule.

**Also: an authenticated tick endpoint.** `POST /internal/scheduler/tick`,
bearer token from `NEUROLINK_SCHEDULER_TOKEN` (environment, never the database),
mounted above CORS like the deployments router so no browser can reach it. It
exists so the feature survives a hosting decision that has not been made yet: on
a platform where the API scales to zero, or where a managed cron is the
idiomatic thing (Render Cron, a GitHub Actions schedule, and yes — `pg_cron` +
`pg_net`, if the token problem is ever solved by a secrets manager), the driver
changes and nothing else does.

**The guarantee is in the claim, not the ticker.** Both paths call the same
function:

```sql
select * from agent_schedule_claim(p_limit => 5, p_lease_seconds => 900);
```

It reaps expired leases, selects due enabled rows `for update skip locked`,
stamps a lease and advances `next_run_at`, and returns what it claimed — all in
one statement. Two API instances ticking simultaneously cannot double-run a
schedule. A tick that arrives while a slow run is still going cannot re-enter
it. A process killed mid-run leaves a lease that expires and a `running` run row
that is reaped and marked `infra_failure` — the same shape, and the same
reasoning, as the abandoned-row reaper at the top of `ai_usage_admit`.

**Tick interval: 60s. Batch: 5 schedules per tick.** At the cadence floor (§6)
a run is due at most every six hours, so a worst-case 60s lateness is noise. The
batch bound is what stops a tick after an outage from starting fifty runs at
once; the rest are simply claimed on the next tick.

---

## 2. Execution model

**Confirmed: it reuses the Phase 1 loop as-is.** No second runtime, no parallel
path, no new tools. The entry point is the same `runChat` the Lab, the Test
panel, a deployed agent and a published page all reach.

New file `server/src/agents/schedule/scheduledRequest.ts`, modelled line-for-line
on `agents/deploymentRequest.ts` — which already solves the hard half of this
problem, because a deployed request is also a server-side invocation with no
browser and no owner present.

```ts
runChat({
  userId: schedule.userId,
  signal: deadline.signal,
  body: {
    ...,
    feature: "agent_scheduled",
    system: composeAgentSystem(agent, knowledge).text,
    messages: [{ role: "user", content: schedule.task }],
    codeExecution: agent.capabilities.includes("code_execution"),
    httpActions:   agent.capabilities.includes("http_actions"),
    stream: false,
  },
  quotaScope: scheduleScope(),
  memoryScope: { kind: "owner", userId, agentId, write: false },
})
```

Point by point, with the decisions that are not obvious:

**Capability flags come off the stored agent row.** Never off the schedule row —
the schedule table has no capability columns at all, which is the structural
version of the promise. `deploymentRequest.ts` refuses `codeExecution` and
`httpActions` by name from a caller's body and reads them from `agent.capabilities`
instead, with a note about why `httpActions` has the sharpest teeth on the list.
The same argument applies here with one extra turn of the screw: an unattended
schedule is a caller that never gets bored. Consequence worth stating plainly —
switching a capability off in the Builder switches it off for the schedule,
immediately, with no schedule edit.

**The system prompt is composed on the server.** The browser is not there to
compose it, which is the same position `routes/ai.ts` is in for an official
agent. Reuse `composeAgentSystem` + `listKnowledge`.

**One message, and it is the owner's own typed string.** No templating, no
interpolation, no prior conversation, nothing fetched. This matters more than it
looks: the entire tool posture assumes the *instruction* is trusted and the
*tool output* is not, and the nonce-fenced result renderer is built around that
asymmetry. A task string that could be assembled from anything external would
invert it.

**No `fileScope`.** Attachments live in an in-process Map with an expiry; a
scheduled run has nothing attached and must not be able to reach what the owner
attached in their browser twenty minutes ago.

**Memory: recall on, write off.** Recall on because it is the owner's own agent
acting on the owner's behalf — unlike a deployment, whose callers get a
deployment-scoped store precisely so strangers do not read the owner's. Write
off because a memory write is an inference about a person drawn from a
conversation, and a scheduled run is not a conversation: it is the same sentence,
four times a day, forever. Everything it could "learn" it already learned on the
first run, so leaving writes on would produce a store full of duplicates of one
fact. Needs a small addition — a `write: false` on `MemoryScope`, or the runner
simply not passing the scope to the write path.

**Its own quota scope, `sched:`.** Following `action:` in `ActionRuntime.ts` and
`embed:` in `EmbeddingRuntime.ts`: same atomic SQL gate, same platform budget,
same usage row, a different key to count under. Two reasons, and they point in
opposite directions, which is what makes a separate scope right rather than
merely convenient. A learner mid-Lab-session must not have their next experiment
refused because a background schedule took the minute's slot. And a schedule
must not be able to fire faster than its own window allows just because the
learner happened to be idle. `scheduleLimitsFor()` in `ai/config.ts`, sized off
the per-day run ceiling.

**A new feature value, `agent_scheduled`.** The eighth widening of
`ai_usage_feature_check` (see 0007–0010, 0013, 0016). Not nameable by a browser:
`CLIENT_FEATURES` in `ai/validation.ts` is an allowlist, so the new value is
excluded by not being added to it — the same silence that keeps `agent_public`
and `agent_site` server-only. The only thing that can write one of these rows is
the runner, and an unattended run must not be able to hide in the ledger as an
`agent_test`.

**No SSE.** The runner consumes the async generator directly and collects it,
the way `respondWhole` does. Deltas concatenate into the output; `tool_call`,
`tool_result` and `tool_limit` accumulate into the trace that §3 then reads.

**A wall-clock deadline: 120s** (`NEUROLINK_SCHEDULE_RUN_TIMEOUT_MS`). This is
the one genuinely new bound, and it exists because of something unattended
execution removes rather than adds. An interactive turn is bounded by a human:
`res.on("close")` aborts the controller when the tab closes, which is what turns
a walked-away-from request into a cancelled provider call. Nothing closes a
scheduled run's tab. The deadline aborts the same `AbortController` the sandbox
and the HTTP client already accept.

**What does not change:** `catalog.ts`, `runJs.ts`, `addresses.ts`,
`request.ts`, `ConnectionStore.ts`, `protocol.ts`, the per-turn nonce, the
streaming scanner, `runTool`'s admission and ledger write, the four-step ceiling.
Zero edits to any of them. If this design requires one, it is wrong.

**No new tools, ever, for this feature.** In particular no "send email" tool.
Notification is the runner's job (§5). A tool the model can call to mail its
owner is a tool a prompt injection can call to mail its owner four hundred times.

---

## 3. Outcomes, failure, and confabulation

### 3.1 The five outcomes

Stored as `agent_schedule_runs.outcome`:

| outcome | means | breaker | output kept |
|---|---|---|---|
| `succeeded` | answered, and its account of itself checks out | resets | yes |
| `limit_reached` | emitted `tool_limit` (`step_limit` or `budget`), then answered | separate counter | yes, flagged amber |
| `confabulated` | claimed to have acted, with nothing in the trace to back it | **counts** | yes, flagged red |
| `infra_failure` | the runtime threw — provider exhaustion, timeout, cancelled, DB | **counts** | no |
| `skipped` | never started — below the XP reserve, agent gone, window collapsed | no | n/a |

`skipped` is the fifth beyond the four asked for, and it earns its place by
being the one thing that must *not* be called a failure. A student who has spent
their XP on lessons has not broken their schedule, and disabling it for that
would be the system punishing them for using the rest of the product.

`limit_reached` is deliberately not a failure either: the run produced an answer.
It gets its own counter and its own, gentler treatment in §4.

### 3.2 Confabulation, as a live check

Phase 1 measured this rather than theorising it. Told it *must* always use a
tool, the model acted once in three and claimed to have run code twice in three
when it had not — because a model that answers directly has broken a rule it was
given, and narrating "I ran a short JavaScript loop" is how it papers over the
gap. The fix was ordering: the anti-confabulation rule goes last in the action
block, immediately before the conversation, naming the exact phrases rather than
describing the offence. `verify-actions-e2e.mts::checkNoConfabulation` is the
regression test that stops that quietly regressing.

That test is currently a private function in a script. **Promote it.**

New module `server/src/agents/schedule/confabulation.ts`, imported by *both* the
runner and `verify-actions-e2e.mts`. One copy of the patterns. The e2e suite
keeps proving the prompt still works; the runner uses the same predicate to
decide what a row says. They cannot drift, because there is nothing to drift
from.

The check is deterministic and costs nothing — no second model call. It compares
what the answer *says about itself* against the event trace the runner already
holds:

```
classify(text, trace):
    ok      = count of tool_result events with ok === true
    calls   = count of tool_call events

    if ok > 0                     -> not inspected          (the common case)
    if claimPattern(text) matches -> CONFABULATED
    else                          -> clean
```

Three things about that shape:

**It only inspects runs where nothing worked.** A run whose tools succeeded is
never examined, so the overwhelmingly common case cannot be falsely flagged. The
regex is only ever pointed at a run that has, by construction, no tool output to
have been honest about.

**`ok === 0` covers the case the e2e suite does not test.** The suite uses a
question the model answers directly, with zero calls. The sharper failure
unattended is *tools ran and every one of them failed, and the agent reported
results anyway* — which is exactly what `renderFailure` exists to prevent
("You have NO result from it. Do not state, guess, or imply what it would have
returned."). Interactively, a student sees the red step and disbelieves the
answer. Nobody sees it here.

**A weaker, advisory signal, recorded but not an outcome.** `capabilities on and
calls === 0` is written to the run row as `no_tools_used`. It is not evidence of
a lie — plenty of tasks legitimately need no tool on a given day — but a
schedule where it is true every single time is a schedule whose task probably
does not need an agent, and the UI can say so.

**Honest limits, which belong in the doc rather than in a comment nobody reads:**

- This checks that the agent's *account of its own actions* matches the trace.
  It does not check that the answer is *correct*. That is a narrower claim than
  "we detect hallucination", and it is the one that can be made without a second
  model call and without a ground truth.
- A regex has false positives. The mitigation is not a better regex, it is what
  happens on a hit: the output is **kept and shown**, with a banner, not
  discarded. A wrong flag costs a student a scary label on a fine answer. A
  missed flag costs a student trusting an invented number they had no way to
  check. Those are not symmetric.
- The negative cases are as important as the positive ones and get their own
  assertions in `verify-schedules.mts`: "I could run", "running this would
  give", "I can check that for you" must never match.

---

## 4. Circuit breaker

Two counters on the schedule row, plus one advisory. Every one of them is reset
to zero by a single `succeeded` run.

| counter | incremented by | trips at | on trip |
|---|---|---|---|
| `consecutive_failures` | `infra_failure`, `confabulated` | **3** | disable + notify |
| `consecutive_confabulations` | `confabulated` | **2** | disable + notify |
| `consecutive_limits` | `limit_reached` | 5 | notify only, stays enabled |

### Why 3 for failures

The provider cascade already absorbs the ordinary flake *inside a single
request*: Groq, then Cloudflare, then OpenRouter, then Mistral, falling through
mid-request on a 429 or a slow first token. So an `infra_failure` reaching a run
row means all four were unavailable, or the quota gate refused, or the database
did — which is a genuinely unusual event and not a blip.

- **1 is wrong** because it would disable a student's schedule over a five-minute
  outage they never knew about, and re-arming requires a deliberate act (below).
- **2 is wrong** because a deploy window or a Supabase maintenance restart can
  easily span two ticks, and at a 6-hour cadence two ticks is not two
  independent samples of anything.
- **3 at the cadence floor is 18 hours of consistent breakage**; at daily
  cadence it is three days. Neither is ambiguous. And the cost of waiting for a
  third is bounded and small — a failed run that never reached a provider costs
  no XP, and one that did costs ~3.

### Why 2 for confabulation

Different failure, different number, and it is worth being explicit about why
this one is stricter rather than folding it into the counter above.

Confabulation is not transient. It means the task instruction and the agent's
capabilities disagree — the coercive-instruction shape Phase 1 measured, where
"you must always use the tool" plus a question the model can answer in its head
produces a confident false claim. Waiting does not fix that; only an edit does.
And the harm is the specific thing this whole phase has to guard against: a
plausible wrong answer delivered to somebody who is not checking, on a schedule.

Two rules out a one-off sampling artefact. Under the measured broken-prompt rate
(~2 in 3) two consecutive is likely within a day; under a working prompt it is
effectively never. One would be jumpy; three would let a lying schedule run for
most of a day.

A single confabulation still notifies immediately (§5). It just does not disable.

### Why `limit_reached` does not disable

The run answered. A schedule that keeps hitting the four-step ceiling is
under-specified, not broken, and the fix is an edit to the task — so the right
response is to tell the student, not to switch their agent off. Five in a row
raises an advisory notification and nothing else.

### On trip

`enabled = false`, `disabled_at = now()`, `disabled_reason` ∈
`consecutive_failures | confabulation | agent_unavailable | owner`, and a
`schedule_disabled` notification with `email_state = 'pending'`.

**Re-arming is deliberate.** The enable toggle does not simply flip back. It
requires a successful **Run once now** against the *current* task text — the
same gate as first enabling it (§8). That turns the breaker from a nuisance into
the one moment the student is guaranteed to look at what their agent actually
did.

### Where the counters are updated

Inside `agent_schedule_settle()`, in the same statement that writes the run row.
Not in Node, afterwards. A process that dies between "record the run" and
"increment the counter" would produce a schedule that fails forever without ever
tripping, and unattended is exactly where nobody notices that.

---

## 5. Notifications

Four kinds, one delivery mechanism, two destinations.

| kind | in-app feed | email |
|---|---|---|
| `run_output` | always | only if the schedule's email toggle is on |
| `run_failed` | always | **first failure of a streak only** |
| `schedule_disabled` | always | **always, unconditionally** |
| `limit_advisory` | always | no |

The `run_failed` rule matters: three failures in a row is one problem, and
emailing three times about it is how a student learns to filter the sender.
After the first, the next email about that schedule is the disable notice.

### The outbox

A `agent_notifications` row carries `email_state` ∈ `none | pending | sent |
failed`. The same tick that runs schedules drains the pending ones. Three
reasons for the outbox rather than sending inline:

- A run's outcome must not depend on a third-party HTTP call. An email provider
  having a bad minute cannot be allowed to turn a `succeeded` run into an
  `infra_failure`.
- Retries need state, and `email_attempts` is where it goes.
- It makes email genuinely optional. With no key configured, rows sit at `none`,
  the feed works completely, and a fresh clone still runs — the same property
  the provider cascade's mock fallback protects.

### Transport — configured and verified

Resend, over plain `fetch`, no SDK — the way every provider adapter in
`ai/providers/` is written. `NEUROLINK_RESEND_API_KEY` and `NEUROLINK_MAIL_FROM`.
Absent key → email disabled, logged once at startup in the banner alongside the
provider chain, feed unaffected.

`scripts/verify-mail.mts` proves the path — **14 passed, 0 failed**, including
one real email accepted by Resend. It drives `createNotification` →
`drainOutbox` → `mail.ts`, so what it proves is the code a scheduled run uses:
there is no second implementation and no hand-built request anywhere in it.

Two things about the provider are not obvious, and each cost this suite a false
failure on its first run:

**A sending-scoped key returns 401 from `/domains`.** That is the correct key to
give this server — it only ever sends — but validating a credential against
`/domains` reports a properly-scoped key as broken. The check now posts to
`/emails` with no recipient and asserts on *which* way it fails: Resend
authorises before it validates the body, so a 422 proves the key while sending
nothing.

**Resend refuses `example.com` recipients by policy**, so the outbox test uses
`delivered@resend.dev` — Resend's own test address, which is accepted, counted
and delivered nowhere. That is what lets the mechanics be proved against a
genuine *successful* send rather than against a rejection.

And one operational constraint worth writing down: `onboarding@resend.dev` is
Resend's shared sender. It needs no verified domain, and in exchange it
**delivers only to the address that owns the Resend account**. Any other
recipient is refused. Emailing real learners needs a verified domain and a
`NEUROLINK_MAIL_FROM` on it; until then email reaches the account owner and the
in-app feed carries everyone else — which is exactly the degradation the outbox
was built for.

The startup banner now says which state it is in:

```
[ai] email: on, from BuildGentic <onboarding@resend.dev> (notifications also stay in the in-app feed)
[ai] email: off — scheduled runs report to the in-app feed only. Set NEUROLINK_RESEND_API_KEY and NEUROLINK_MAIL_FROM to send.
```

The from-address is printed and the key never is, the same rule `describeChain`
follows. The address earns its place because it is the half that fails quietly:
a missing key disables email loudly and everything else keeps working, but an
unverified from-address produces a 422 per send, on a timer, visible only in
`agent_notifications.email_error`.

### Two things about email that are security decisions, not preferences

**The destination is not configurable.** It is `auth.users.email` for the
schedule's owner, read server-side with the service role. There is no field in
the schedule UI for an address. This is the difference between "your agent tells
you what it found" and "your agent is a mail sender", and the second one is a
thing students would discover within a week.

**The body is `text/plain` only. No HTML part.** A scheduled run's output is
model text that may quote arbitrary bytes an API returned. Rendering that as
HTML in somebody's inbox would hand a fetched payload a rendering context —
markup, a tracking pixel, a link that does not say where it goes. Plain text,
truncated to ~2000 characters, with a link back into the app for the full run.

And the outcome category goes in the **first line of the email**, not just in the
app. A `confabulated` or `limit_reached` run must be labelled where the student
actually reads it.

### In-app

- A bell in `AppShell` with an unread count (`read_at is null`).
- A Dashboard card: "Latest from your scheduled agents" — the three most recent
  run outputs.
- The run history on the schedule page itself (§8).

---

## 6. Guardrails for unattended execution

### 6.1 Frequency floor: 6 hours

Not a guess — arithmetic off the actual XP economy.

```
daily login grant .......... 40 XP        (user_credits.daily_allowance, 0011)
balance ceiling ............ 300 XP       (user_credits.max_balance, 0014)
a scheduled run ............ 2 XP  (agent_scheduled, at agent_test parity)
                           + 1 XP  (SURCHARGES.actions, if it acted)
                           = ~3 XP
```

| cadence | runs/day | XP/day | share of the daily grant |
|---|---|---|---|
| hourly | 24 | 72 | **180%** |
| every 3h | 8 | 24 | 60% |
| **every 6h** | **4** | **12** | **30%** |
| daily | 1 | 3 | 7.5% |

Hourly is not a policy choice, it is arithmetic that does not close: one schedule
would consume nearly twice what a student earns in a day, every day, and the
first thing they would learn about agents is that theirs stopped working. Six
hours costs 30% of the grant and leaves the Lab usable, which is the point of the
whole product.

**Cadence is a closed union, not a cron string:**
`every_6_hours | every_12_hours | daily | weekly`. Three reasons. It makes the
floor structural rather than validated — the same argument `ActionToolId` makes
for being a closed union, that there is no path from input to something outside
the list. A student aged 15 should not have to learn `0 */6 * * *` to use this.
And four options render as four buttons.

### 6.2 Two enabled schedules per learner

`NEUROLINK_SCHEDULE_MAX_PER_USER = 2`. At the floor that is 24 XP/day worst
case — 60% of the grant, which is the most that background automation should
ever take from a person's foreground learning. Enforced atomically in the enable
path (a count inside `agent_schedule_enable`), not in the browser, because "at
most two" is not expressible as a table constraint.

### 6.3 An XP reserve: skip below 10

A scheduled run does not start when the owner's balance is under 10 XP. It
records `skipped` / `out_of_xp`, does not touch the breaker, and after three
consecutive skips raises one notification.

Automation must never spend the last XP a student needs for a lesson. This is a
teaching tool; the background thing yields to the foreground thing.

### 6.4 No catch-up

If the API was down for eighteen hours, a 6-hourly schedule fires **once**, not
three times. `agent_schedule_claim` computes the next due time forward from
`now()`, not from the stale `next_run_at`, and records how many windows were
skipped as `missed_runs` on the run row so the student can see the gap.

Backlog replay is the classic way an unattended system converts an outage into a
bill, and there is no version of "here are your three identical 4am digests at
once" that anybody wants.

### 6.5 Step budget: **unchanged at 4** — the direct answer

Scheduled runs should *not* get a tighter step budget. Three reasons.

**The ceiling cannot compound.** A scheduled run is exactly one turn. The loop
closes itself: on hitting the limit, `closing = true` rebuilds the request
without the action block and without a scanner, so whatever the model writes next
is the answer and there is no way to talk into another turn. Whatever the number
is, a run costs at most that many tool calls. The runaway that unattended
execution actually introduces is *many runs*, and that is bounded by §6.1, §6.2
and §4 — not by shaving a step.

**Cutting it would break the property this codebase works hardest to keep.**
`deploymentRequest.ts` reads capability flags off the stored row specifically so
that "the deployed agent does exactly what the tested one does" is true by
construction rather than by two implementations agreeing. A 3-step scheduled loop
against a 4-step Test panel breaks that in the worst possible direction: **Run
once now** would be evidence about a different loop than the scheduled one, so a
schedule failing at step 4 would pass every manual test the student ran.

**The fourth step is worth more unattended, not less.** Four was chosen as
"three covers the real shapes — fetch then compute, compute then check, fetch
then fetch then combine — and the fourth is headroom for a model that wastes
one". A student watching the Test panel who sees a wasted step just presses Run
again. Nobody is there to press Run.

**What does get tighter, instead:**

| bound | interactive | scheduled | why |
|---|---|---|---|
| steps | 4 | 4 | above |
| wall clock | none (bounded by the human) | 120s | §2 |
| quota windows | the learner's | `sched:`, its own | §2 |
| runs/day | unbounded | 4 | §6.1 |
| concurrent runs per user | n/a | 1 | the lease |

### 6.6 The task is immutable per run

The one message the model sees is the string the owner typed, unchanged. No
interpolation of the previous run's output, no chaining, no "and use what you
found last time". A schedule is a repeated single turn, not a growing
conversation. Chained state is a Phase 3 conversation and it is a much larger
security question, because the moment run *n*'s output becomes run *n+1*'s
instruction, a poisoned API response gets to write the prompt.

---

## 7. Schema — migration 0017

Style follows 0013/0016: idempotent throughout, owner-read RLS, writes through
the service role, and a header saying what will break if it is not applied.

### 7.1 The eighth widening

```sql
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory',
    'agent_site', 'site_edit', 'agent_action', 'agent_scheduled'
  ));
```

Same operator failure mode 0016 documents, and worse here: ship the TypeScript
without this and every scheduled run fails inside the insert — with nobody
watching, on a timer, filling the run table with `infra_failure` until the
breaker disables every schedule on the platform. The startup banner should assert
this value is accepted before the ticker starts.

### 7.2 `agent_schedules`

```sql
create table if not exists public.agent_schedules (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null,
  user_id       uuid not null references auth.users (id) on delete cascade,

  label         text not null,
  -- The whole of what the model is told, every run. See §6.6.
  task          text not null,

  cadence       text not null,           -- every_6_hours|every_12_hours|daily|weekly
  hour_local    smallint not null default 9,   -- daily/weekly only
  weekday_local smallint,                      -- 0..6, weekly only
  timezone      text not null default 'UTC',   -- IANA; ignored by interval cadences

  enabled       boolean not null default false,
  next_run_at   timestamptz,
  last_run_at   timestamptz,

  -- Held by the claim. An expired lease is reaped, not respected.
  lease_until   timestamptz,

  consecutive_failures       smallint not null default 0,
  consecutive_confabulations smallint not null default 0,
  consecutive_limits         smallint not null default 0,
  consecutive_skips          smallint not null default 0,

  disabled_at     timestamptz,
  disabled_reason text,

  -- Which task text the last successful manual run proved. The
  -- enable gate compares this against `task`; editing the task
  -- re-locks the toggle, because a changed instruction is an
  -- untested one. See §8.
  verified_task_hash text,

  notify_email      boolean not null default true,
  notify_on_success boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  constraint agent_schedules_cadence check (
    cadence in ('every_6_hours','every_12_hours','daily','weekly')),
  constraint agent_schedules_task_length check (length(task) between 10 and 2000),
  constraint agent_schedules_hour check (hour_local between 0 and 23),
  constraint agent_schedules_weekday check (
    cadence <> 'weekly' or weekday_local between 0 and 6),
  constraint agent_schedules_disabled_reason check (
    disabled_reason is null or disabled_reason in (
      'consecutive_failures','confabulation','agent_unavailable','owner')),
  constraint agent_schedules_enabled_has_next check (
    not enabled or next_run_at is not null)
);

create index if not exists agent_schedules_due_idx
  on public.agent_schedules (next_run_at) where enabled;
create index if not exists agent_schedules_owner_idx
  on public.agent_schedules (user_id, created_at);
```

The composite foreign key is the one 0013 and 0016 both carry, for the same
reason: it makes "a schedule on somebody else's agent" unrepresentable rather
than merely unreachable.

### 7.3 `agent_schedule_runs`

```sql
create table if not exists public.agent_schedule_runs (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.agent_schedules (id) on delete cascade,
  agent_id    uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,

  trigger     text not null default 'schedule',   -- schedule | manual
  outcome     text,                               -- null while running
  detail      text,          -- error_code, or 'step_limit'/'budget', or 'out_of_xp'

  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  latency_ms  integer,

  output           text,
  output_truncated boolean not null default false,
  finish_reason    text,

  steps         smallint not null default 0,
  tool_calls    smallint not null default 0,
  tool_failures smallint not null default 0,
  -- The wire events, verbatim. Already redacted: a connection's
  -- secret is attached by the server on the way out and never
  -- appears in `args`.
  trace         jsonb not null default '[]'::jsonb,

  -- The §3.2 verdict, kept as evidence rather than just a label.
  claim_matched boolean not null default false,
  claim_phrase  text,
  no_tools_used boolean not null default false,

  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  xp_spent      smallint not null default 0,

  -- Windows collapsed by the no-catch-up rule. See §6.4.
  missed_runs   smallint not null default 0,

  constraint agent_schedule_runs_outcome check (
    outcome is null or outcome in (
      'succeeded','limit_reached','confabulated','infra_failure','skipped')),
  constraint agent_schedule_runs_trigger check (trigger in ('schedule','manual'))
);

create index if not exists agent_schedule_runs_schedule_idx
  on public.agent_schedule_runs (schedule_id, started_at desc);
create index if not exists agent_schedule_runs_user_idx
  on public.agent_schedule_runs (user_id, started_at desc);
```

`output` and `trace` are capped by the runner before insert (output ~20k chars,
each trace entry's `args` ~1k). A run row is a record, not a blob store.

### 7.4 `agent_notifications`

```sql
create table if not exists public.agent_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  schedule_id uuid references public.agent_schedules (id) on delete cascade,
  run_id      uuid references public.agent_schedule_runs (id) on delete set null,

  title text not null,
  body  text not null,

  read_at timestamptz,

  email_state    text not null default 'none',
  email_attempts smallint not null default 0,
  email_error    text,

  created_at timestamptz not null default now(),

  constraint agent_notifications_kind check (kind in (
    'run_output','run_failed','schedule_disabled','limit_advisory')),
  constraint agent_notifications_email_state check (
    email_state in ('none','pending','sent','failed'))
);

create index if not exists agent_notifications_user_idx
  on public.agent_notifications (user_id, created_at desc);
create index if not exists agent_notifications_outbox_idx
  on public.agent_notifications (created_at) where email_state = 'pending';
```

### 7.5 Functions

**`agent_schedule_claim(p_limit int, p_lease_seconds int)`** — the load-bearing
one. In one statement: reap expired leases (marking their orphaned `running` run
rows `infra_failure` / `abandoned`, the `ai_usage_admit` pattern); select due
enabled rows `for update skip locked`; stamp `lease_until`; advance `next_run_at`
forward *from now* per §6.4; return the claimed rows with their `missed_runs`.

**`agent_schedule_settle(p_run_id, p_outcome, p_detail, ...)`** — writes the run
row's terminal fields, moves the four counters, trips the breaker if a threshold
is crossed, and inserts the notification row. One statement, for the reason in
§4: a run must not be recordable without its counter moving.

**`agent_schedule_enable(p_schedule_id, p_user_id)`** — counts the user's enabled
schedules against the cap, checks `verified_task_hash` matches the current
`task`, computes the first `next_run_at`, flips `enabled`. Atomic so two tabs
cannot both be the second schedule.

### 7.6 RLS and retention

Owner-read on all three tables (`auth.uid() = user_id`), `revoke all ... from
anon`, every write through the service role. Same posture as `agent_connections`
and `agent_sites`, with a sharper reason than either: a browser that could
`update agent_schedules set consecutive_failures = 0` could keep a broken — or
lying — schedule alive forever.

Retention: run rows past 30 days, and beyond the newest 50 per schedule, are
deleted inside `agent_schedule_claim` — swept on write, no timer, the FileStore
pattern. If a `pg_cron` maintenance job is ever wanted for this, it is a pure-SQL
job with no HTTP and no secret, and it is the one place §1.1 says `pg_cron` is
the right tool.

---

## 8. Student-facing UX

New page `AgentSchedule.tsx` at `/agents/:agentId/schedule`, alongside the
existing `/deploy` and `/site`.

**Configure**

- **Label** — "Morning news digest".
- **Task** — a textarea, with the warning stated where it cannot be missed:
  *this exact sentence is everything your agent is told, every time. It cannot
  see this page, and it does not remember the last run.*
- **Cadence** — four buttons (every 6 hours / every 12 hours / daily / weekly),
  with time-of-day and weekday pickers appearing only where they apply, and the
  resolved next run shown in the student's own timezone: "next run: tomorrow,
  09:00".
- **Cost, up front, in the same card:** *"every 6 hours ≈ 12 XP a day. You earn
  40 XP a day."* Students should not have to discover the price by running out.
- **Where the output goes** — the feed, always; plus an email toggle showing the
  account address greyed out and non-editable, labelled "goes to your account
  email" so the constraint in §5 reads as a fact rather than a missing feature.

**Run once now — and the gate**

The enable toggle is locked until a manual run of the *current* task text has
returned `succeeded`. It runs the identical path (`trigger: 'manual'`), costs the
same XP, writes a real run row, and shows the same run card the history shows.
Editing the task re-locks it.

This is the single most valuable piece of UX here. It costs one run to learn
that the task is wrong, instead of a day of failures the student finds out about
by email — and it is the moment they see, once, what their agent actually does
when nobody is looking.

**Run history**

A list of run cards: outcome chip (green `succeeded` / amber `limit_reached` /
red `confabulated` / grey `skipped` / red `infra_failure`), timestamp, duration,
XP, step count, expandable to the tool trace and the full output. The trace
renderer is the Test panel's existing step list, reused — the same component
showing the same events, which is the visible half of "same loop".

The flags are written for a fifteen-year-old, not for a log:

- `confabulated` → *"This run said it ran a tool. Nothing ran. Do not trust any
  numbers in it."*
- `limit_reached` → *"Ran out of its 4 steps and answered with what it had."*
- `skipped / out_of_xp` → *"Skipped — your balance was under 10 XP."*

**Disabled state**

When the breaker has tripped, the page leads with it: *"Disabled after 3 failed
runs"*, the three failing run cards inline, and the **Run once now** button as
the only way forward.

**Global**

A bell in `AppShell` with the unread count, and a Dashboard card carrying the
three most recent run outputs.

---

## 9. Verification plan

Two suites, matching the Phase 1 pair.

**`scripts/verify-schedules.mts`** — offline, no server, no keys, no database:
cadence → `next_run_at` arithmetic including DST boundaries and the weekly
wrap; the confabulation classifier over positive *and* negative fixtures
("I could run", "running this would give" must not match); outcome
categorisation from synthetic event traces, including the tools-ran-and-all-
failed case; the breaker state machine across mixed sequences; no-catch-up
collapsing three missed windows into one run.

**`scripts/verify-schedules-e2e.mts`** — live, against a real model and the real
database: migration 0017 applied (a row written, not a catalogue read — 0016's
lesson); enable → claim → run → settle end to end; two concurrent ticks claim
each schedule exactly once; a deliberately coercive task lands as `confabulated`
rather than `succeeded`; a schedule pointed at a dead connection trips the
breaker in exactly three runs and writes exactly one disable notification; the
ledger carries `agent_scheduled` rows and the tool rows still carry
`tool:run_code` where a model id would go.

And one move inside the existing suite: `checkNoConfabulation` in
`verify-actions-e2e.mts` switches to importing the shared classifier, so the
regression test and the runtime check are provably the same predicate.

---

## 10. Decisions I made that are worth overruling if you disagree

1. **Memory writes are off for scheduled runs** (§2). Recall stays on. If you
   want a schedule to accumulate what it learns, that is a different and larger
   design — see §6.6 on chaining.
2. **6 hours, not 1 hour** (§6.1). Driven by the 40 XP/day grant. If the grant
   changes, this number changes with it.
3. **Steps stay at 4** (§6.5). This is the one I would most expect pushback on,
   and the argument that decides it is the tested-equals-scheduled property, not
   the safety one.
4. **Two counters, 3 and 2** (§4), rather than one threshold for everything.
5. **A fifth outcome, `skipped`** (§3.1), so "out of XP" can never read as a
   failure.
6. **Email destination is fixed to the account address** (§5). This closes off
   "email my results to my study group", which is a genuinely nice feature and a
   genuinely bad idea to build on an agent runtime.

## 11. The one open question

**Where does the API run in production?** As of this writing: nowhere. There is
no deploy configuration in the tree and none in git history on any branch, no
CI, and — until the prerequisite below was closed — no way to start the server
outside `tsx watch`.

That sounds like it leaves §1 wide open. It does not, because **Phase 1 already
eliminated most of the option space**, and that is worth recording here rather
than rediscovering it under time pressure.

### The sandbox constrains the platform

Two things in the action loop are not portable:

- `sandbox/runJs.ts` spawns a real child process — `spawn(process.execPath, ["--permission", "--max-old-space-size=…", "--eval", RUNNER_SOURCE])`.
- `http/addresses.ts` resolves DNS itself and checks the resolved addresses
  against the private ranges before a socket is opened.

Neither survives a serverless function runtime. **Vercel and Netlify functions,
Cloudflare Workers, and Supabase Edge Functions cannot host this API at all** —
not "would need adapting", cannot: there is no `child_process` to spawn into and
no raw socket layer to guard. The same fact §0 uses to keep the loop in Express
also decides where Express itself may live.

So the host is necessarily something that runs a long-lived Node process —
Render, Railway, Fly, or a VM. On every one of those the **in-process ticker is
the correct default**, and `/internal/scheduler/tick` is insurance rather than
the mechanism.

The sandbox is indifferent to *how* the server is started, which is what makes
this safe to settle in advance: the child is spawned with `--eval` and an
inlined source string, so there is no sibling file to locate and no difference
between running under `tsx` and running from compiled output. `runner.ts` says
so in its own header, and it was written that way on purpose.

### The one hosting choice that would actually hurt

Not serverless — a **sleeping free tier**. A Render free web service spins down
after ~15 minutes of inactivity, and a container that is asleep has no ticker
running and nothing to wake it. Schedules would simply stop firing between
visits, silently, which is the exact failure mode this whole phase exists to
make impossible.

That is the case where `/internal/scheduler/tick` stops being insurance and
becomes load-bearing: an external cron hitting it both fires the due runs *and*
wakes the service. It is worth knowing before a tier is picked, because it is a
billing decision that quietly disables a product feature.

### What is genuinely still open

One line of deploy configuration: whether `NEUROLINK_SCHEDULER` is `internal`
(always-on host — the expected answer) or `external` with a platform cron
pointed at the tick endpoint (a tier that sleeps). Both are in the design, both
call the same claim, and neither blocks writing any of it.

### Prerequisite, now closed

Deploying at all needed three things the backend did not have, none of them
Phase 2 work:

- `server/package.json` had no `start` and no `build` script — only
  `tsx watch src/index.ts`, a development file-watcher.
- `server/tsconfig.json` is `noEmit: true` by design (see its own comment: the
  cross-boundary imports from `../src` need bundler resolution, which cannot
  emit), so nothing produced a runnable artifact.
- `tsx` was a devDependency, which mattered only if it were the production
  runtime.

Resolved by having **esbuild** produce the artifact rather than `tsc`:
`npm run build` bundles `src/index.ts` to `dist/index.mjs`, and
`npm start` runs `node dist/index.mjs`. `tsx` stays a devDependency because it
is not the production runtime — `runner.ts` already assumed compiled output
there. See §12 for why the flags are what they are.

---

## 12. The backend build (prerequisite, done)

```
"build": "npm run typecheck && esbuild src/index.ts --bundle --platform=node
          --target=node24 --format=esm --outfile=dist/index.mjs --packages=external"
"start": "node dist/index.mjs"
```

Every flag there is load-bearing, so none of them should be tidied away later.

**esbuild rather than `tsc`.** `server/tsconfig.json` is `noEmit: true` and
explains why in its own comment: the server imports real values across the
boundary from `../src` (the curriculum registry, the site schema, the flagship
list), which needs `moduleResolution: "bundler"` — and bundler resolution cannot
emit. Making `tsc` the emitter would mean adding explicit `.js` extensions to
every relative import in the frontend, which is the rewrite that comment exists
to refuse. esbuild resolves those imports at build time, exactly as `tsx` does
at run time, so the constraint is satisfied rather than worked around.

**`typecheck &&` first.** esbuild strips types without checking them. A build
that cannot fail on a type error is not a gate, so `tsc` still runs — it just no
longer pretends to produce the artifact.

**`--packages=external`.** Required, not merely tidy.
`files/extract/pdf.ts` resolves its own install directory at runtime:

```ts
dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))
```

Bundling `pdfjs-dist` would move the code away from the package whose path it
is trying to find. Keeping every dependency external means the host runs
`npm ci` in `server/` and that resolution keeps working — `pdfjs-dist` installs
to `server/node_modules`, which `server/dist/index.mjs` resolves correctly.

**`--format=esm`, output `.mjs`.** The same line above uses `import.meta.url`,
which does not exist in CommonJS. `server/package.json` declares
`"type": "commonjs"`, so an `index.js` would be read as CJS whatever esbuild
emitted; the `.mjs` extension is ESM regardless of that field, which keeps the
build honest without changing how `tsx` reads the tree in development.

**`tsx` stays a devDependency.** It is not the production runtime, and the
sandbox is indifferent to which runtime is: the child is spawned as
`spawn(process.execPath, [..., "--eval", RUNNER_SOURCE])` with an inlined source
string, so there is no sibling file whose location differs between `tsx` and a
bundle. `runner.ts` states this in its header and was written for it.

**Verified, not assumed:** the bundle boots and prints the full startup banner;
`import.meta.url` survives; `RUNNER_SOURCE` is inlined; `express`, `cors`,
`dotenv`, `@supabase/supabase-js` and the dynamic `pdfjs-dist` import all stay
external; `verify-actions.mts` still passes 90/0.
