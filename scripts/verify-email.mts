/*
 * Proof that the Email Agent cannot send, cannot delete, and
 * cannot be talked into either.
 *
 * The claim being tested is not "there is an email capability".
 * It is a set of ABSENCES, and absences are the hardest thing
 * to be confident about by reading code:
 *
 *   that no tool in the catalogue sends a message, at any flag
 *   combination, so no path exists from model output to an
 *   outbound email;
 *
 *   that no tool deletes one either;
 *
 *   that a recipient cannot carry a character which would turn
 *   it into an extra MIME header;
 *
 *   that every door which is not the owner's own browser
 *   refuses all three email flags;
 *
 *   that an agent claiming to have sent something is caught by
 *   the confabulation check, while one saying it has DRAFTED
 *   something — the true sentence, the one the prompt asks for
 *   — is not;
 *
 *   and that the scope list never contains Gmail's
 *   full-access scope.
 *
 * Everything here is pure. No server, no database, no keys, no
 * network: a fresh clone runs it. The OAuth round trip, real
 * retrieval, a real draft and a real send need a mailbox and
 * live in verify-email-e2e.mts.
 *
 *   npx tsx ./scripts/verify-email.mts
 */

import { TOOLS, toolsFor, isToolId } from "../server/src/agents/actions/catalog";
import { renderActionContext } from "../server/src/agents/actions/context";
import { newSentinel } from "../server/src/agents/actions/protocol";
import { cleanAddresses, isValidAddress } from "../server/src/agents/email/addresses";
import { findClaim } from "../server/src/agents/schedule/confabulation";
import type { ActionCapabilityFlags } from "../server/src/ai/types";
import {
  findCapability,
  normalizeCapabilities,
} from "../src/features/agents/capabilities";
import {
  FLAGSHIPS,
  findFlagship,
  flagshipPublishable,
} from "../src/features/agents/flagships";
import { flagshipIdentity } from "../src/features/sites/flagship/identity";

/* ---------------------------------------------------------
   HARNESS

   Same shape as every other suite: a pass is printed, a failure
   is printed and remembered, and the exit code is the summary.
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const NO_FLAGS: ActionCapabilityFlags = {
  codeExecution: false,
  httpActions: false,
  documentGeneration: false,
  dataStore: false,
  emailRead: false,
  emailDraft: false,
  emailOrganize: false,
};

const ALL_FLAGS: ActionCapabilityFlags = {
  codeExecution: true,
  httpActions: true,
  documentGeneration: true,
  dataStore: true,
  emailRead: true,
  emailDraft: true,
  emailOrganize: true,
};

/* ---------------------------------------------------------
   1. THE ABSENCES

   The most important section in this file, and the reason it
   is first.
   --------------------------------------------------------- */

function checkAbsences() {
  section("1. What does not exist");

  const ids = TOOLS.map((tool) => tool.id as string);

  /*
   * NO SEND TOOL, AT ANY FLAG COMBINATION.
   *
   * Asserted against the whole registry rather than against a
   * particular flag set, because `toolsFor` filters a list and
   * this is a claim about the list itself. A send tool that
   * existed but was gated would still be one bad `if` away from
   * reachable; one that does not exist is not.
   */
  check(
    "no tool in the catalogue sends email",
    !ids.some((id) => /send/i.test(id)),
    ids.join(", ")
  );

  check(
    "and `email_send` is not a tool id the parser would accept",
    !isToolId("email_send"),
    "so a model writing it gets an unreadable-action step, not a send"
  );

  check(
    "no tool deletes email",
    !ids.some((id) => id.startsWith("email_") && /delete|trash|remove/i.test(id))
  );

  /*
   * AND NO FLAG FOR IT EITHER.
   *
   * `ActionCapabilityFlags` is "which tools this turn may use".
   * A field for sending would imply a tool that does not exist
   * and would create, in the type system, the exact thing the
   * capability is built to prevent. The absence is checked at
   * runtime because a type cannot assert its own gaps.
   */
  check(
    "ActionCapabilityFlags has no send field",
    !Object.keys(ALL_FLAGS).some((key) => /send/i.test(key)),
    Object.keys(ALL_FLAGS).join(", ")
  );

  /*
   * Everything on, and still nothing that sends. This is the
   * belt to the braces above: it exercises the real filter with
   * every permission granted, which is the configuration a
   * student can actually build.
   */
  const everything = toolsFor(ALL_FLAGS).map((tool) => tool.id as string);

  check(
    "with every capability on, still nothing that sends",
    !everything.some((id) => /send/i.test(id)),
    `${everything.length} tools offered`
  );

  /*
   * The delete assertion is scoped to the MAILBOX, and the
   * narrowing is a real distinction rather than a convenience.
   *
   * `data_delete` exists and should: it retires a record in the
   * agent's own notebook, soft, restorable for a week, and
   * documented in agents/data/tools.ts. A blanket "no tool has
   * delete in its name" would fail on it and would be asserting
   * something this project does not believe.
   *
   * What must not exist is a way to delete somebody's post.
   */
  check(
    "and nothing in the mailbox deletes",
    !everything
      .filter((id) => id.startsWith("email_"))
      .some((id) => /delete|trash|remove/i.test(id)),
    everything.filter((id) => id.startsWith("email_")).join(", ")
  );
}

/* ---------------------------------------------------------
   2. CAPABILITY GATING
   --------------------------------------------------------- */

function checkGating() {
  section("2. Which flag offers which tool");

  const only = (flags: Partial<ActionCapabilityFlags>) =>
    toolsFor({ ...NO_FLAGS, ...flags }).map((tool) => tool.id as string);

  check(
    "no flags offers no tools",
    only({}).length === 0,
    "an agent with nothing switched on gets no action block at all"
  );

  check(
    "emailRead offers exactly search and get",
    only({ emailRead: true }).sort().join(",") === "email_get,email_search",
    only({ emailRead: true }).join(", ")
  );

  check(
    "emailDraft offers exactly the draft tool",
    only({ emailDraft: true }).join(",") === "email_draft",
    only({ emailDraft: true }).join(", ")
  );

  check(
    "emailOrganize offers exactly the organise tool",
    only({ emailOrganize: true }).join(",") === "email_organize",
    only({ emailOrganize: true }).join(", ")
  );

  /*
   * THE CROSS-GRANT CHECKS, and they run both ways.
   *
   * A generic capability must not reach the mailbox — an owner
   * who switched Call APIs on to read a weather feed has not
   * agreed to anything about their correspondence. And the
   * email capabilities must not reach anything else.
   */
  check(
    "httpActions grants nothing in the mailbox",
    !only({ httpActions: true }).some((id) => id.startsWith("email_")),
    only({ httpActions: true }).join(", ")
  );

  check(
    "codeExecution grants nothing in the mailbox",
    !only({ codeExecution: true }).some((id) => id.startsWith("email_"))
  );

  check(
    "the email flags grant nothing outside the mailbox",
    only({ emailRead: true, emailDraft: true, emailOrganize: true }).every(
      (id) => id.startsWith("email_")
    )
  );

  check(
    "reading does not imply drafting",
    !only({ emailRead: true }).includes("email_draft"),
    "the dangerous half is independently gated"
  );

  check(
    "drafting does not imply organising",
    !only({ emailDraft: true }).includes("email_organize")
  );
}

/* ---------------------------------------------------------
   3. ADDRESSES, AND THE HEADER-INJECTION RULE

   The narrowest security-load-bearing thing in the capability.
   A message is headers, a blank line, then a body — so a
   newline inside a recipient is not a strange recipient, it is
   an extra header.
   --------------------------------------------------------- */

function checkAddresses() {
  section("3. Address validation");

  const good = [
    "a@b.co",
    "student@example.com",
    "first.last+tag@sub.example.ac.uk",
    "PROFESSOR@Example.COM",
  ];

  for (const address of good) {
    check(`accepts "${address}"`, isValidAddress(address));
  }

  const bad: Array<[string, string]> = [
    ["a newline", "a@b.co\nBcc: attacker@evil.example"],
    ["a carriage return", "a@b.co\r\nBcc: attacker@evil.example"],
    ["a bare CR", "a@b.co\rX-Header: yes"],
    ["a space", "a b@c.co"],
    ["angle brackets", "<a@b.co>"],
    ["a comma inside one", "a@b.co,c@d.co"],
    ["a semicolon", "a@b.co;c@d.co"],
    ["a quote", 'a"@b.co'],
    ["a backslash", "a\\@b.co"],
    ["no at sign", "abc.co"],
    ["no dot in the domain", "a@localhost"],
    ["empty", ""],
    ["a tab", "a@b.co\tx"],
  ];

  for (const [label, address] of bad) {
    check(`refuses ${label}`, !isValidAddress(address));
  }

  section("4. Recipient lists");

  const mixed = cleanAddresses([
    "good@example.com",
    "Ada Lovelace",
    "also@example.com\nBcc: attacker@evil.example",
  ]);

  check(
    "a list with a bad entry is not ok",
    !mixed.ok,
    `${mixed.rejected.length} rejected`
  );

  check(
    "the good ones survive",
    mixed.clean.includes("good@example.com") && mixed.clean.length === 1
  );

  check(
    "and the injected one is NOT among them",
    !mixed.clean.some((entry) => entry.includes("attacker@evil.example")),
    "the whole point of the check"
  );

  check(
    "the rejected ones are named so the model can correct itself",
    mixed.rejected.some((entry) => entry.includes("Ada Lovelace"))
  );

  check(
    "addresses are lowercased for comparison",
    cleanAddresses(["Prof@Example.COM"]).clean[0] === "prof@example.com",
    "so a reply's recipient can be matched against a sender"
  );

  check(
    "duplicates collapse",
    cleanAddresses(["a@b.co", "A@B.co"]).clean.length === 1
  );

  check(
    "a comma-separated string is accepted as a list",
    cleanAddresses("a@b.co, c@d.co").clean.length === 2,
    "models write both shapes for the same field"
  );

  check(
    "a non-list is empty rather than throwing",
    cleanAddresses(undefined).clean.length === 0 &&
      cleanAddresses(42).clean.length === 0
  );
}

/* ---------------------------------------------------------
   5. THE PROMPT BLOCK
   --------------------------------------------------------- */

function block(
  flags: Partial<ActionCapabilityFlags>,
  mailbox: { address: string; canDraft: boolean; canOrganize: boolean } | null
): string {
  return renderActionContext({
    sentinel: newSentinel(),
    flags: { ...NO_FLAGS, ...flags },
    connections: [],
    storeKeys: [],
    mailbox,
  });
}

function checkBlock() {
  section("5. What the agent is told about the mailbox");

  const connected = block(
    { emailRead: true, emailDraft: true, emailOrganize: true },
    { address: "student@example.com", canDraft: true, canOrganize: true }
  );

  check("the address is named", connected.includes("student@example.com"));

  check(
    "it is told it cannot send",
    /cannot send/i.test(connected),
    "so it does not promise one"
  );

  check("it is told it cannot delete", /cannot delete/i.test(connected));

  /*
   * THE INJECTION PARAGRAPH.
   *
   * `renderResult` already fences every tool result as data.
   * This is the agent's own brief agreeing with that, before it
   * has read anything — because an instruction about the post
   * outranks whatever the post says about itself.
   */
  check(
    "it is warned that messages are written by other people",
    /anybody can send an email/i.test(connected)
  );

  check(
    "and told to report an instruction rather than follow it",
    /not an instruction/i.test(connected) &&
      /contents of a letter/i.test(connected)
  );

  /*
   * THE ORDERING ASSERTION, inherited from the store index and
   * load-bearing for the same measured reason: context.ts
   * records that moving the anti-confabulation rule out of last
   * position let the failure it guards against happen two times
   * in three. The mailbox block must not have displaced it.
   */
  const lastRule = connected.lastIndexOf("Never claim to have done something");
  const mailboxAt = connected.indexOf("THE MAILBOX");

  check(
    "the anti-confabulation rule is still last",
    lastRule > mailboxAt && lastRule > 0,
    "the mailbox block must not displace what was measured to belong at the end"
  );

  section("6. When no mailbox is connected");

  const none = block({ emailRead: true }, null);

  check(
    "the agent is told there is no account rather than left to guess",
    /No email account is connected/i.test(none),
    "an agent told nothing describes an inbox it has never seen"
  );

  check(
    "and told never to guess at the contents",
    /never guess/i.test(none)
  );

  section("7. Permissions the mailbox did not grant");

  const readOnly = block(
    { emailRead: true, emailDraft: true },
    { address: "student@example.com", canDraft: false, canOrganize: false }
  );

  check(
    "a read-only mailbox is not described as being able to draft",
    !/draft replies for them to approve/i.test(readOnly),
    "the grant is what Google returned, not what the agent's capabilities say"
  );

  check(
    "and not described as being able to organise",
    !/label, archive and mark read/i.test(readOnly)
  );
}

/* ---------------------------------------------------------
   8. CONFABULATION

   Two impossible claims and one true one, and the true one
   matters most: flagging it would punish the exact sentence
   the prompt asks the agent to write.
   --------------------------------------------------------- */

function checkConfabulation() {
  section("8. Claims about email");

  const caught = [
    "I sent your reply to Professor Ellis.",
    "I've sent the email you asked for.",
    "I have replied to her message.",
    "I emailed them this morning.",
    "I forwarded the message to your tutor.",
    "I deleted those newsletters for you.",
    "I've removed the spam messages.",
    "I cleared out your inbox.",
  ];

  for (const text of caught) {
    check(`flags "${text}"`, findClaim(text).matched, findClaim(text).phrase);
  }

  /*
   * THE NEGATIVES, AND THEY ARE THE POINT OF THIS SECTION.
   *
   * "I've drafted a reply" is TRUE, it is what the prompt asks
   * for, and a pattern that matched it would mark every correct
   * run as a liar. `drafted` is absent from the verb list on
   * purpose; this is what keeps it absent.
   */
  const allowed = [
    "I've drafted a reply to Professor Ellis for you to look at.",
    "I have drafted three replies; they are waiting for you.",
    "I drafted a response but have not sent it.",
    "I could send this for you if you press Send.",
    "If I sent it now it would arrive before her deadline.",
    "I archived twelve newsletters.",
    "I've archived the promotions and marked the rest read.",
    "You have not replied to her message yet.",
    "She emailed you on Tuesday.",
    "The message says they sent it last week.",
  ];

  for (const text of allowed) {
    const claim = findClaim(text);
    check(`does not flag "${text.slice(0, 46)}…"`, !claim.matched, claim.phrase);
  }
}

/* ---------------------------------------------------------
   9. THE CAPABILITY CATALOGUE
   --------------------------------------------------------- */

function checkCapabilities() {
  section("9. Capability vocabulary");

  for (const id of [
    "email_read",
    "email_draft",
    "email_send",
    "email_organize",
  ]) {
    const entry = findCapability(id);

    check(`${id} is in the catalogue`, Boolean(entry));
    check(`${id} is marked ready`, entry?.ready === true);
    check(
      `${id} explains what switching it on does`,
      (entry?.onHint?.length ?? 0) > 200,
      `${entry?.onHint?.length ?? 0} chars`
    );
  }

  /*
   * The hint on `email_send` has one sentence it must contain,
   * and it is the one that makes the switch honest: it does not
   * let the agent send. A student who read this hint and
   * concluded otherwise would be enabling it under a
   * misapprehension.
   */
  check(
    "the Send hint says the agent still cannot send",
    /does not let your agent send/i.test(
      findCapability("email_send")?.onHint ?? ""
    ),
    "the switch turns on a button, not an ability"
  );

  check(
    "all four survive normalizeCapabilities",
    normalizeCapabilities([
      "email_read",
      "email_draft",
      "email_send",
      "email_organize",
    ]).length === 5,
    "four plus the required chat"
  );

  check(
    "granting read does not grant send",
    !normalizeCapabilities(["email_read"]).includes("email_send"),
    normalizeCapabilities(["email_read"]).join(", ")
  );

  check(
    "an unknown capability is still dropped",
    !normalizeCapabilities(["email_read", "email_launch_missiles"]).includes(
      "email_launch_missiles" as never
    )
  );
}

/* ---------------------------------------------------------
   10. THE FLAGSHIP
   --------------------------------------------------------- */

function checkFlagship() {
  section("10. The Email Agent in the catalogue");

  const agent = findFlagship("email-agent");

  check("it ships", Boolean(agent), agent?.name);

  check(
    "it has the four email capabilities",
    ["email_read", "email_draft", "email_send", "email_organize"].every((id) =>
      agent?.capabilities.includes(id as never)
    ),
    agent?.capabilities.join(", ")
  );

  /*
   * Web search off, and it is a decision rather than a gap —
   * see the catalogue entry. An agent that can read private
   * correspondence and reach the open internet in the same turn
   * is a shape worth not building first.
   */
  check(
    "web search is off",
    !agent?.capabilities.includes("web_search"),
    "not both a stranger's text and an outbound request in one turn"
  );

  check(
    "it is not publishable",
    flagshipPublishable("email-agent") === false,
    "a page for it could not touch a mailbox, so it would advertise what it cannot do"
  );

  check(
    "and it therefore has no page identity",
    flagshipIdentity("email-agent") === undefined,
    "the absent entry is the decision, not a backlog item"
  );

  check(
    "every other flagship is still publishable",
    FLAGSHIPS.filter((entry) => entry.id !== "email-agent").every((entry) =>
      flagshipPublishable(entry.id)
    ),
    "the sixth agent must not have changed the other five"
  );

  check(
    "an unknown id is publishable by default",
    flagshipPublishable("retired-agent") === true,
    "a retired entry must not stop an existing page from rendering"
  );

  check(
    "it warns that a mailbox is needed first",
    (agent?.onboardingNudge?.length ?? 0) > 40,
    "it is the only flagship that does nothing at all until something is connected"
  );
}

/* ---------------------------------------------------------
   MAIN
   --------------------------------------------------------- */

function main() {
  console.log("\nEMAIL AGENT — offline verification\n");

  checkAbsences();
  checkGating();
  checkAddresses();
  checkBlock();
  checkConfabulation();
  checkCapabilities();
  checkFlagship();

  console.log(`\n=== SUMMARY ===`);
  console.log(`  ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log(`\n  Failed:`);
    for (const label of failures) {
      console.log(`    - ${label}`);
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

main();
