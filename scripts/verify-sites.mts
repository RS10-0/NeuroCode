/*
 * Proof that the Phase 2.7 published-page model works.
 *
 * Two halves, and only the first one runs without a server.
 *
 * The PURE half exercises the two shared modules — the slug
 * rules and the config schema — directly, with no database and
 * no HTTP. They are worth testing this way because they are the
 * only code in BuildGentic imported by both the browser and the
 * server, so a mistake in either is a mistake in two places at
 * once, and because everything the feature claims about safety
 * reduces to "the schema refuses that".
 *
 * The LIVE half is the usual harness: throwaway learners, real
 * rows, assertions that read the database rather than an API's
 * own report of success. It mirrors verify-deployments.mts
 * deliberately.
 *
 *   npx tsx ./scripts/verify-sites.mts          (both halves)
 *   npx tsx ./scripts/verify-sites.mts --pure   (no server needed)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import {
  canonicalizeSlug,
  checkSlug,
  deriveSlug,
  fallbackSlug,
  isValidSlug,
  RESERVED_SLUGS,
  slugCandidates,
  SLUG_MAX_LENGTH,
} from "../src/features/sites/slug";
import {
  defaultSiteConfig,
  LIMITS,
  parseSiteConfig,
  readSiteConfig,
  SiteConfigError,
  TEMPLATE_IDS,
} from "../src/features/sites/schema";
import { starterConfig, TEMPLATES } from "../src/features/sites/templates";
import {
  applyEdits,
  describeConfig,
  parseEditPlan,
  type SiteEdit,
} from "../src/features/sites/edits";

/* ---------------------------------------------------------
   HARNESS
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* Asserts that a call throws a SiteConfigError, which is the
   only way the schema is allowed to refuse something. */
function refuses(label: string, run: () => unknown) {
  try {
    run();
    check(label, false, "accepted, should have refused");
  } catch (error) {
    check(
      label,
      error instanceof SiteConfigError,
      error instanceof SiteConfigError
        ? `refused at ${error.path}`
        : `wrong error type: ${String(error)}`
    );
  }
}

/* =========================================================
   PURE — SLUGS
========================================================= */

function checkSlugDerivation() {
  section("Slug derivation");

  const cases: Array<[string, string]> = [
    ["StudyBuddy", "studybuddy"],
    ["Ms. Nakamura's Lab Helper", "ms-nakamuras-lab-helper"],
    /* NFKD decomposition then mark-stripping. Without it this
       becomes "caf-r-sum", which is the classic slug bug. */
    ["Café Résumé", "cafe-resume"],
    ["!!! Physics Tutor !!!", "physics-tutor"],
    ["a   b---c", "a-b-c"],
    ["3D Printing Helper", "3d-printing-helper"],
    /* Nothing survives the filter, so it falls back rather than
       refusing — the student is shown the result and can type
       over it. */
    ["🤖🤖", "agent"],
    ["スタディ", "agent"],
    /* Too short to be a slug on its own. */
    ["Hi", "hi-agent"],
  ];

  for (const [input, expected] of cases) {
    const actual = deriveSlug(input);
    check(`"${input}" -> ${expected}`, actual === expected, actual);
  }

  const long = deriveSlug("The Quick Brown Fox Jumped Over The Lazy Dog");
  check(
    "long names are truncated within the ceiling",
    long.length <= SLUG_MAX_LENGTH && isValidSlug(long),
    long
  );
  check(
    "truncation never leaves a trailing hyphen",
    !long.endsWith("-"),
    long
  );

  check(
    "every derived slug is a valid slug",
    cases.every(([input]) => isValidSlug(deriveSlug(input))),
    "derivation and validation agree"
  );
}

function checkSlugRules() {
  section("Slug rules");

  const bad: Array<[string, string]> = [
    ["login", "reserved"],
    ["dashboard", "reserved"],
    ["api", "reserved"],
    /* Not a route — a phishing surface. A chat box at
       /support on BuildGentic's own domain is the problem. */
    ["support", "reserved"],
    ["billing", "reserved"],
    ["neurolink-official", "reserved"],
    /* Reserved as a future route, so a printed poster does not
       break the day BuildGentic ships a pricing page. */
    ["pricing", "reserved"],
    ["2024", "numeric"],
    ["-leading", "charset"],
    ["trailing-", "charset"],
    ["double--hyphen", "charset"],
    ["StudyBuddy", "charset"],
    ["study_buddy", "charset"],
    ["study.buddy", "charset"],
    ["ab", "too_short"],
    ["a".repeat(SLUG_MAX_LENGTH + 1), "too_long"],
    ["", "empty"],
  ];

  for (const [value, problem] of bad) {
    const result = checkSlug(value);
    check(
      `"${value}" refused as ${problem}`,
      !result.ok && result.problem === problem,
      result.problem ?? "accepted"
    );
  }

  for (const value of ["studybuddy", "study-buddy-2", "3d-printing", "a1b"]) {
    check(`"${value}" accepted`, checkSlug(value).ok);
  }

  check(
    "every live app route is reserved",
    ["agents", "courses", "dashboard", "lab", "learn", "login", "onboarding",
     "profile", "projects", "register", "dev", "build", "lessons"]
      .every((route) => RESERVED_SLUGS.has(route)),
    `${RESERVED_SLUGS.size} reserved words`
  );

  section("Canonicalisation");

  for (const raw of ["StudyBuddy", "/studybuddy", "studybuddy/", "  StudyBuddy  "]) {
    check(
      `"${raw}" canonicalises to studybuddy`,
      canonicalizeSlug(raw) === "studybuddy",
      canonicalizeSlug(raw)
    );
  }
}

function checkSlugCollisions() {
  section("Slug collisions");

  const ladder = slugCandidates("studybuddy", 8);

  check("ladder offers the base first", ladder[0] === "studybuddy", ladder[0]);
  check(
    "then memorable numbers",
    ladder[1] === "studybuddy-2" && ladder[2] === "studybuddy-3",
    ladder.slice(1, 3).join(", ")
  );
  check("ladder has no duplicates", new Set(ladder).size === ladder.length);
  check("every rung is valid", ladder.every(isValidSlug));
  check("ladder fills to the requested size", ladder.length === 8, String(ladder.length));

  /* A base already at the ceiling has to give up characters to
     the suffix rather than the suffix being dropped. */
  const long = slugCandidates("a".repeat(SLUG_MAX_LENGTH), 6);
  check(
    "suffixes respect the length ceiling",
    long.every((slug) => slug.length <= SLUG_MAX_LENGTH),
    `max ${Math.max(...long.map((s) => s.length))}`
  );
  check("suffixed long slugs stay valid", long.every(isValidSlug));

  /* The ladder re-checks every rung, so a reserved base is
     never offered even though it was asked for. */
  const reserved = slugCandidates("login", 4);
  check(
    "a reserved base is not offered",
    !reserved.includes("login"),
    reserved[0]
  );
  check("but numbered forms of it are", reserved.every(isValidSlug), reserved.join(", "));

  const fallback = fallbackSlug("studybuddy");
  check(
    "fallback is valid and differs from the base",
    isValidSlug(fallback) && fallback !== "studybuddy",
    fallback
  );

  /* The race-loser path must not propose the same address
     twice, or it would lose the same race again. */
  const fallbacks = new Set(
    Array.from({ length: 20 }, () => fallbackSlug("studybuddy"))
  );
  check(
    "fallbacks are unpredictable",
    fallbacks.size >= 18,
    `${fallbacks.size}/20 distinct`
  );
}

/* =========================================================
   PURE — THE CONFIG SCHEMA

   The security claim of the whole feature is that a page is a
   closed document and the renderer can display nothing that is
   not a field in it. These are the tests of that claim.
========================================================= */

function checkSchemaAcceptance() {
  section("Schema — defaults and templates");

  for (const template of TEMPLATE_IDS) {
    const config = starterConfig({
      agentName: "StudyBuddy",
      description: "A revision partner.",
      template,
    });

    check(
      `${template} starter parses`,
      parseSiteConfig(config).template === template
    );
  }

  check(
    "every template has a definition",
    TEMPLATE_IDS.every((id) => TEMPLATES.some((entry) => entry.id === id)),
    `${TEMPLATES.length} templates`
  );

  check(
    "templates place the chat differently",
    new Set(TEMPLATES.map((entry) => entry.chatPlacement)).size ===
      TEMPLATES.length,
    TEMPLATES.map((entry) => entry.chatPlacement).join(", ")
  );

  /*
   * Switching templates must be reversible. If a layout could
   * drop a section kind it does not draw, a student who tried
   * the portfolio and went back would have lost their FAQ.
   */
  const withEverything = parseSiteConfig({
    ...starterConfig({
      agentName: "Everything",
      description: "",
      template: "assistant",
    }),
    sections: [
      { kind: "about", title: "About", body: "Body." },
      { kind: "features", title: "Features", items: [{ icon: "book", title: "One", body: "x" }] },
      { kind: "steps", title: "Steps", items: [{ title: "One", body: "x" }] },
      { kind: "faq", title: "FAQ", items: [{ question: "Why?", answer: "Because." }] },
      { kind: "text", title: "Notes", body: "Body." },
    ],
  });

  let carried = withEverything;

  for (const template of [...TEMPLATE_IDS, "assistant" as const]) {
    carried = parseSiteConfig({ ...carried, template });
  }

  check(
    "a round trip through every template loses no section",
    carried.sections.length === 5 &&
      carried.sections.map((s) => s.kind).join(",") ===
        "about,features,steps,faq,text",
    carried.sections.map((s) => s.kind).join(",")
  );
}

function checkSchemaRefusal() {
  section("Schema — what it refuses");

  const base = defaultSiteConfig({ agentName: "Fixture" });

  refuses("an unknown template", () =>
    parseSiteConfig({ ...base, template: "custom" })
  );
  refuses("an unknown palette", () =>
    parseSiteConfig({ ...base, theme: { ...base.theme, palette: "#ff0000" } })
  );
  refuses("a raw colour as a mode", () =>
    parseSiteConfig({ ...base, theme: { ...base.theme, mode: "rgb(0,0,0)" } })
  );
  refuses("an unknown section kind", () =>
    parseSiteConfig({
      ...base,
      sections: [{ kind: "html", title: "x", body: "y" }],
    })
  );
  refuses("an unknown feature icon", () =>
    parseSiteConfig({
      ...base,
      sections: [
        {
          kind: "features",
          title: "x",
          items: [{ icon: "<img>", title: "t", body: "b" }],
        },
      ],
    })
  );
  refuses("an over-long headline", () =>
    parseSiteConfig({
      ...base,
      hero: { ...base.hero, headline: "a".repeat(LIMITS.headline + 1) },
    })
  );
  refuses("an empty headline", () =>
    parseSiteConfig({ ...base, hero: { ...base.hero, headline: "   " } })
  );
  refuses("too many sections", () =>
    parseSiteConfig({
      ...base,
      sections: Array.from({ length: LIMITS.sections + 1 }, () => ({
        kind: "text",
        title: "x",
        body: "y",
      })),
    })
  );
  refuses("a document from a future schema version", () =>
    parseSiteConfig({ ...base, version: 99 })
  );
  refuses("a non-object", () => parseSiteConfig("<h1>hi</h1>"));
  refuses("an array", () => parseSiteConfig([]));

  /*
   * Every field legal, and the sum not.
   *
   * Built from item-bearing sections rather than text ones,
   * because those are the actual worst case: eight sections of
   * maximum-length prose come to about 11KB and are meant to
   * fit, while eight sections of eight maximum-length feature
   * cards come to nearly 30KB and are not. A ceiling that only
   * caught the first would be a ceiling that never fired.
   */
  refuses("a document over the total byte ceiling", () =>
    parseSiteConfig({
      ...base,
      sections: Array.from({ length: LIMITS.sections }, () => ({
        kind: "features",
        title: "a".repeat(LIMITS.sectionTitle),
        items: Array.from({ length: LIMITS.items }, () => ({
          icon: "spark",
          title: "t".repeat(LIMITS.itemTitle),
          body: "b".repeat(LIMITS.itemBody),
        })),
      })),
    })
  );

  /* The other side of the same line: a full page of prose is
     meant to fit, and a ceiling that rejected it would be one
     students hit while writing normally. */
  check(
    "a full page of prose stays under the ceiling",
    (() => {
      try {
        parseSiteConfig({
          ...base,
          sections: Array.from({ length: LIMITS.sections }, () => ({
            kind: "text",
            title: "a".repeat(LIMITS.sectionTitle),
            body: "b".repeat(LIMITS.sectionBody),
          })),
        });
        return true;
      } catch {
        return false;
      }
    })(),
    `${LIMITS.sections} sections of ${LIMITS.sectionBody} chars`
  );

  section("Schema — what it strips");

  /*
   * Markup is not refused, it is kept as text. That is the
   * point: the renderer emits it through React's children, so
   * a script tag becomes the literal characters of a script
   * tag. Refusing it instead would mean a student could not
   * write about HTML on a page about their coding project.
   */
  const withMarkup = parseSiteConfig({
    ...base,
    sections: [
      {
        kind: "text",
        title: "Notes",
        body: '<script>alert(1)</script> and <b>bold</b>',
      },
    ],
  });

  const body =
    withMarkup.sections[0].kind === "text" ? withMarkup.sections[0].body : "";

  check(
    "markup survives as literal text",
    body === '<script>alert(1)</script> and <b>bold</b>',
    body.slice(0, 40)
  );

  /* An unknown key is dropped rather than carried into the
     row, so nothing downstream can ever read it. */
  const extra = parseSiteConfig({
    ...base,
    onclick: "alert(1)",
    customCss: "body{display:none}",
    __proto__: { polluted: true },
  } as Record<string, unknown>);

  check(
    "unknown keys are dropped, not stored",
    !("onclick" in extra) && !("customCss" in extra),
    Object.keys(extra).join(", ")
  );

  const controls = parseSiteConfig({
    ...base,
    hero: { ...base.hero, headline: "Clean  title" },
  });

  check(
    "control characters are stripped",
    controls.hero.headline === "Clean title",
    JSON.stringify(controls.hero.headline)
  );

  section("Schema — lenient read");

  /*
   * Reading never throws. A row written by an older build or
   * edited by hand must still produce a page that renders,
   * because the agent behind it still works and the address has
   * already been shared.
   */
  for (const junk of [null, undefined, 42, "nonsense", {}, { template: "bogus" }]) {
    const recovered = readSiteConfig(junk, "Fixture");

    check(
      `readSiteConfig survives ${JSON.stringify(junk)}`,
      recovered.siteName === "Fixture" && recovered.hero.headline.length > 0
    );
  }
}

/* =========================================================
   PURE — PHASE 2, NATURAL-LANGUAGE EDITS

   The claim being tested is the one the whole phase rests on:
   a model's output cannot become anything the operation
   vocabulary does not name, and cannot become anything the
   schema would refuse. Both gates are exercised here with the
   kind of output a model actually produces when it is confused
   or being led.
========================================================= */

function checkEditParsing() {
  section("Edits — parsing what a model said");

  const plan = parseEditPlan({
    edits: [
      { op: "set_theme", mode: "dark" },
      { op: "set_hero", headline: "Ask StudyBuddy" },
    ],
    unsupported: [],
    summary: "Made it darker.",
  });

  check("a well-formed plan parses", plan.edits.length === 2, plan.summary);

  /* Everything below is a model going wrong in a way that has
     to be absorbed rather than trusted. */
  const hostile = parseEditPlan({
    edits: [
      /* Operations that do not exist. */
      { op: "set_html", html: "<script>alert(1)</script>" },
      { op: "run_code", code: "fetch('https://evil.test')" },
      { op: "set_css", css: "body{display:none}" },
      { op: "eval", source: "process.exit()" },
      /* Real operations with values outside the vocabulary. */
      { op: "set_theme", palette: "#ff0000" },
      { op: "set_theme", mode: "rgb(0,0,0)" },
      { op: "set_template", template: "custom" },
      { op: "add_section", kind: "html", body: "<b>x</b>" },
      /* Malformed refs. */
      { op: "remove_section", ref: 0 },
      { op: "remove_section", ref: -3 },
      { op: "remove_section", ref: "all" },
      { op: "move_section", ref: 1, direction: "sideways" },
      /* Not objects at all. */
      "delete everything",
      null,
      42,
      ["op", "set_theme"],
      /* One legitimate operation, to prove the good survives. */
      { op: "set_theme", mode: "dark" },
    ],
    unsupported: [],
    summary: "x",
  });

  check(
    "every invented operation is dropped",
    hostile.edits.length === 1 && hostile.edits[0].op === "set_theme",
    `${hostile.edits.length} survived: ${hostile.edits
      .map((e) => e.op)
      .join(", ")}`
  );

  check(
    "no operation carries markup or code",
    !/<script|<b>|fetch\(|process\./.test(JSON.stringify(hostile.edits)),
    JSON.stringify(hostile.edits)
  );

  /* A plan is not a document. A model handing back a whole
     SiteConfig is not a way to bypass the operations. */
  const smuggled = parseEditPlan({
    edits: [],
    config: { template: "assistant", hero: { headline: "owned" } },
    unsupported: [],
    summary: "x",
  });

  check(
    "a whole config in the response is ignored",
    smuggled.edits.length === 0 && !("config" in smuggled),
    Object.keys(smuggled).join(", ")
  );

  /* One request must not be able to rewrite the entire page. */
  const flood = parseEditPlan({
    edits: Array.from({ length: 60 }, () => ({ op: "set_theme", mode: "dark" })),
    unsupported: [],
    summary: "x",
  });

  check(
    "the number of operations per request is capped",
    flood.edits.length === 12,
    `${flood.edits.length} kept`
  );

  /* A response that is not a plan at all is a model failure the
     student needs told about, not silently "nothing to do". */
  for (const junk of ["I am sorry, I cannot help with that.", 42, null, []]) {
    let threw = false;

    try {
      parseEditPlan(junk);
    } catch {
      threw = true;
    }

    check(`a non-plan response is refused: ${JSON.stringify(junk)}`, threw);
  }

  section("Edits — the unsupported path");

  const refused = parseEditPlan({
    edits: [{ op: "set_theme", mode: "dark" }],
    unsupported: ["Adding your logo needs an image, which pages cannot hold."],
    summary: "Darkened the page.",
  });

  check(
    "a partly-impossible request keeps both halves",
    refused.edits.length === 1 && refused.unsupported.length === 1,
    refused.unsupported[0]
  );

  const allRefused = parseEditPlan({
    edits: [],
    unsupported: ["Custom CSS is not something a page can hold."],
    summary: "Could not do that.",
  });

  check(
    "a wholly-impossible request applies nothing",
    allRefused.edits.length === 0 && allRefused.unsupported.length === 1
  );
}

function checkEditApplying() {
  section("Edits — applying");

  const base = parseSiteConfig(
    starterConfig({
      agentName: "StudyBuddy",
      description: "A revision partner.",
      template: "assistant",
    })
  );

  const darker = parseSiteConfig(
    applyEdits(base, [{ op: "set_theme", mode: "dark" }])
  );

  check(
    "make it darker lands on theme.mode",
    darker.theme.mode === "dark" && darker.theme.palette === base.theme.palette,
    `${darker.theme.palette}/${darker.theme.mode}`
  );

  const added = parseSiteConfig(
    applyEdits(base, [
      {
        op: "add_section",
        kind: "text",
        title: "What I do",
        body: "I help with revision.",
      },
    ])
  );

  check(
    "add a section explaining what I do adds one text block",
    added.sections.length === base.sections.length + 1 &&
      added.sections[added.sections.length - 1].kind === "text",
    `${added.sections.length} sections`
  );

  /* Applying must not disturb what was not named. */
  check(
    "an edit changes nothing it did not name",
    JSON.stringify(added.hero) === JSON.stringify(base.hero) &&
      JSON.stringify(added.chat) === JSON.stringify(base.chat) &&
      added.theme.palette === base.theme.palette,
    "hero, chat and theme untouched"
  );

  /* Operations pointing at nothing are no-ops, not crashes. */
  const outOfRange = parseSiteConfig(
    applyEdits(base, [
      { op: "remove_section", ref: 99 },
      { op: "update_section", ref: 99, title: "ghost" },
      { op: "move_section", ref: 99, direction: "up" },
      { op: "move_section", ref: 1, direction: "up" },
    ])
  );

  /* Compared on content rather than on the whole object,
     because parseSiteConfig regenerates section ids by design —
     see the note on `newSectionId` in schema.ts. Ids are
     bookkeeping and are never shown, so two parses of the same
     page differ in them and in nothing else. */
  const stripIds = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(stripIds);
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== "id")
          .map(([key, entry]) => [key, stripIds(entry)])
      );
    }

    return value;
  };

  const shape = (config: { sections: unknown[] }) =>
    JSON.stringify(stripIds(config.sections));

  check(
    "operations pointing past the end are no-ops",
    shape(outOfRange) === shape(base),
    `${outOfRange.sections.length} sections, unchanged`
  );

  /* The second gate: a value the model padded past the cap is
     clipped at parse, so it reaches the schema already legal. */
  const trimmed = parseEditPlan({
    edits: [{ op: "set_hero", headline: "x".repeat(LIMITS.headline + 400) }],
    unsupported: [],
    summary: "",
  });

  check(
    "an over-long value is truncated at parse rather than refused",
    trimmed.edits.length === 1 &&
      parseSiteConfig(applyEdits(base, trimmed.edits)).hero.headline.length ===
        LIMITS.headline,
    "clipped to the field cap"
  );

  /* Section overflow: twelve adds onto a page that allows eight. */
  const manyAdds: SiteEdit[] = Array.from({ length: 12 }, (_, i) => ({
    op: "add_section",
    kind: "text",
    title: `Extra ${i}`,
    body: "x",
  }));

  const capped = parseSiteConfig(applyEdits(base, manyAdds));

  check(
    "adding past the section ceiling stops at the ceiling",
    capped.sections.length === LIMITS.sections,
    `${capped.sections.length} sections`
  );

  section("Edits — the page as the model sees it");

  const outline = describeConfig(base);

  check(
    "the outline numbers the sections from 1",
    outline.includes("  1. ["),
    outline.split("\n").find((l) => l.trim().startsWith("1.")) ?? "(none)"
  );

  check(
    "the outline carries no internal ids",
    !outline.includes(base.sections[0].id),
    "ids withheld"
  );

  check(
    "the outline names the current template and palette",
    outline.includes(base.theme.palette) && outline.includes(base.template),
    "theme and template present"
  );
}

/* =========================================================
   LIVE — the database and the two endpoints
========================================================= */

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* Absent in a pure run. */
  }

  return out;
}

const serverEnv = readEnv("server/.env");
const webEnv = readEnv(".env.local");
const API = process.env.API_BASE ?? "http://localhost:3001";

/*
 * Whether migration 0013 has been applied.
 *
 * Asked by WRITING rather than by reading the schema, for the
 * reason recorded in the project's notes: a CHECK constraint is
 * invisible through PostgREST, so the only honest way to find
 * out whether `agent_site` is an accepted feature value is to
 * try to insert one.
 *
 * The probe needs a REAL user id, and that is the whole reason
 * this function creates one. An earlier version used the
 * all-zero uuid, which tripped `ai_usage_user_id_fkey` before
 * the CHECK was ever evaluated — and because the assertion only
 * looked for "feature_check" in the message, a foreign-key
 * error counted as a pass. The test reported success without
 * having tested anything. Inserting as a throwaway learner
 * means the only constraint left standing between the row and
 * the table is the one being asked about.
 */
async function checkSchemaApplied(): Promise<boolean> {
  section("Migration 0013");

  const url = serverEnv.SUPABASE_URL;
  const key = serverEnv.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    check("server/.env carries Supabase credentials", false, "not found");
    return false;
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: tableError } = await admin
    .from("agent_sites")
    .select("id")
    .limit(1);

  check(
    "agent_sites exists",
    !tableError,
    tableError?.message ?? "readable by the service role"
  );

  if (tableError) {
    return false;
  }

  const { error: rpcError } = await admin.rpc("agent_site_usage", {
    p_deployment_id: "00000000-0000-0000-0000-000000000000",
  });

  check(
    "agent_site_usage() exists",
    !rpcError,
    rpcError?.message ?? "callable by the service role"
  );

  /* The columns the store selects. A migration applied from an
     older copy of the file would pass the table check above and
     fail here, which is the failure worth catching. */
  const { error: columnError } = await admin
    .from("agent_sites")
    .select("id, deployment_id, agent_id, user_id, slug, config, published, created_at, updated_at")
    .limit(1);

  check(
    "agent_sites has every column the store reads",
    !columnError,
    columnError?.message ?? "all present"
  );

  /* ----- the CHECK constraint, probed as a real learner ----- */

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `neurolink-sites-verify+probe-${stamp}@example.com`;

  const created = await admin.auth.admin.createUser({
    email,
    password: `verify-${crypto.randomUUID()}`,
    email_confirm: true,
    /* Matches makeLearner in verify-deployments.mts. Without
       it, user creation fails on this project. */
    user_metadata: { username: `sites-verify-${stamp}` },
  });

  if (created.error || !created.data.user) {
    check(
      "a probe learner could be created",
      false,
      created.error?.message ?? "no user returned"
    );
    return false;
  }

  const probeUserId = created.data.user.id;
  let constraintOk = true;

  try {
    for (const feature of ["agent_site", "site_edit"] as const) {
      const probe = await admin
        .from("ai_usage")
        .insert({
          user_id: probeUserId,
          quota_key: `verify-sites-probe-${feature}`,
          power_source_kind: "platform",
          provider_id: "probe",
          model: "probe",
          feature,
          status: "done",
          ok: false,
          error_code: "probe",
        })
        .select("id")
        .maybeSingle();

      /*
       * Strict: the row must actually land. Any error at all is
       * a failure now, rather than "any error that does not
       * mention feature_check", which is what let the
       * foreign-key case through.
       */
      const wrote = !probe.error && Boolean(probe.data?.id);

      if (!wrote) {
        constraintOk = false;
      }

      check(
        `ai_usage accepts feature = '${feature}'`,
        wrote,
        probe.error?.message ?? `row ${probe.data?.id} written and removed`
      );

      if (probe.data?.id) {
        await admin.from("ai_usage").delete().eq("id", probe.data.id);
      }
    }

    /* And the negative case, which is what proves the positive
       one meant something: a value the constraint does not list
       must still be refused. If this passes, the CHECK is not
       being enforced and the two above proved nothing. */
    const bogus = await admin
      .from("ai_usage")
      .insert({
        user_id: probeUserId,
        quota_key: "verify-sites-probe-bogus",
        power_source_kind: "platform",
        provider_id: "probe",
        model: "probe",
        feature: "definitely_not_a_feature",
        status: "done",
        ok: false,
      })
      .select("id")
      .maybeSingle();

    check(
      "ai_usage still refuses an unknown feature",
      Boolean(bogus.error) && /feature_check/i.test(bogus.error?.message ?? ""),
      bogus.error?.message ?? "ACCEPTED — the CHECK is not being enforced"
    );

    if (bogus.data?.id) {
      await admin.from("ai_usage").delete().eq("id", bogus.data.id);
    }
  } finally {
    await admin.from("ai_usage").delete().eq("user_id", probeUserId);

    const removed = await admin.auth.admin.deleteUser(probeUserId);

    check(
      "the probe learner is deleted",
      !removed.error,
      removed.error?.message ?? "cleaned up"
    );
  }

  return !rpcError && !columnError && constraintOk;
}

async function checkPublicEndpoint() {
  section("Public endpoint");

  let reachable = true;

  try {
    const response = await fetch(`${API}/api/sites/definitely-not-a-real-page`);

    check(
      "an unknown slug is a 404",
      response.status === 404,
      `status ${response.status}`
    );

    const body = (await response.json()) as Record<string, unknown>;

    check(
      "the 404 body says nothing about who owns anything",
      !("userId" in body) && !("agentId" in body) && !("deploymentId" in body),
      Object.keys(body).join(", ")
    );
  } catch (error) {
    reachable = false;
    check(
      "the API is reachable",
      false,
      `${API} - ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!reachable) {
    return;
  }

  /*
   * A reserved word can never be a page, so the resolver
   * answers without querying. Asked here because it is the one
   * case where the router and the store have to agree: /login
   * is the application's, and no student may hold it.
   */
  const reserved = await fetch(`${API}/api/sites/login`);

  check(
    "a reserved slug is a 404, not a page",
    reserved.status === 404,
    `status ${reserved.status}`
  );

  /* No credential is presented, and none is asked for. That is
     the whole point of the endpoint, so it is worth asserting
     rather than assuming. */
  const noAuth = await fetch(`${API}/api/sites/definitely-not-a-real-page`);

  check(
    "no 401 is ever returned — this endpoint has no identity",
    noAuth.status !== 401,
    `status ${noAuth.status}`
  );
}

/* =========================================================
   LIVE — persistence, isolation and the public path

   Throwaway learners, real rows, and assertions that read the
   DATABASE rather than an API's own report of success. Mirrors
   verify-deployments.mts deliberately: the same harness, the
   same lifecycle, the same rule that a 200 is not evidence.
========================================================= */

interface Learner {
  id: string;
  email: string;
  token: string;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

function adminClient() {
  return createClient(serverEnv.SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function makeLearner(tag: string): Promise<Learner> {
  const admin = adminClient();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `neurolink-sites-verify+${tag}-${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `sites-verify-${tag}-${stamp}` },
  });

  if (created.error || !created.data.user) {
    throw new Error(`Could not create a test learner: ${created.error?.message}`);
  }

  const anon = createClient(serverEnv.SUPABASE_URL, webEnv.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await anon.auth.signInWithPassword({ email, password });

  if (signIn.error || !signIn.data.session) {
    throw new Error(`Could not sign in: ${signIn.error?.message}`);
  }

  return { id: created.data.user.id, email, token: signIn.data.session.access_token };
}

async function makeAgent(
  learner: Learner,
  name: string,
  status: "draft" | "ready"
): Promise<string> {
  const admin = adminClient();

  const { data, error } = await admin
    .from("agents")
    .insert({
      user_id: learner.id,
      name,
      description: "Created by verify-sites.mts",
      avatar_emoji: "📚",
      avatar_tone: "accent",
      system_instructions: "You are a test fixture. Answer in one short sentence.",
      model: "neurolink-1",
      temperature: 0.7,
      max_output_tokens: 64,
      capabilities: ["chat"],
      status,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not create the fixture agent: ${error?.message}`);
  }

  return data.id as string;
}

async function owned(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Reply> {
  const response = await fetch(`${API}/api/agents${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* Non-JSON body; `raw` still carries it. */
  }

  return { status: response.status, body: parsed, raw };
}

async function publicGet(path: string): Promise<Reply> {
  const response = await fetch(`${API}/api/sites${path}`);
  const raw = await response.text();
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* Non-JSON body. */
  }

  return { status: response.status, body: parsed, raw };
}

function siteOf(reply: Reply): Record<string, unknown> {
  return (reply.body.site ?? {}) as Record<string, unknown>;
}

async function checkLivePersistence(owner: Learner, other: Learner) {
  const admin = adminClient();

  section("Publishing");

  const draftAgent = await makeAgent(owner, "Sites draft fixture", "draft");
  const agentId = await makeAgent(owner, "StudyBuddy fixture", "ready");

  /* A page is a door onto a deployment, so there must never be
     one without a deployment behind it. */
  const noDeployment = await owned(owner.token, "POST", `/${agentId}/site`, {});

  check(
    "publishing without a deployment is refused",
    noDeployment.status === 400,
    `status ${noDeployment.status}: ${noDeployment.body.error ?? ""}`
  );

  const deployed = await owned(owner.token, "POST", `/${agentId}/deployment`, {});

  check(
    "the fixture agent deploys",
    deployed.status === 200 || deployed.status === 201,
    `status ${deployed.status}`
  );

  const published = await owned(owner.token, "POST", `/${agentId}/site`, {
    slug: "studybuddy-verify",
  });

  check(
    "publishing a page returns 201",
    published.status === 201,
    `status ${published.status}: ${published.body.error ?? ""}`
  );

  const site = siteOf(published);
  const slug = String(site.slug ?? "");

  check("the page has the requested address", slug === "studybuddy-verify", slug);

  check(
    "the response carries a shareable URL",
    typeof site.url === "string" && String(site.url).endsWith(`/${slug}`),
    String(site.url)
  );

  /* The database, not the API's own word for it. */
  const { data: row } = await admin
    .from("agent_sites")
    .select("id, slug, config, published, user_id, agent_id, deployment_id")
    .eq("slug", slug)
    .maybeSingle();

  check("the row exists in agent_sites", Boolean(row), row ? "found" : "missing");

  check(
    "the row belongs to the owner and the agent",
    row?.user_id === owner.id && row?.agent_id === agentId,
    "ownership recorded"
  );

  const storedConfig = (row?.config ?? {}) as Record<string, unknown>;

  check(
    "the stored config is a real document, not an empty default",
    typeof storedConfig.template === "string" &&
      typeof storedConfig.hero === "object",
    `template=${String(storedConfig.template)}`
  );

  section("The public page");

  const openPage = await publicGet(`/${slug}`);

  check("the published address resolves", openPage.status === 200, `status ${openPage.status}`);

  check(
    "it carries the agent's name and the page config",
    typeof openPage.body.config === "object" &&
      Boolean((openPage.body.agent as Record<string, unknown> | undefined)?.name),
    String((openPage.body.agent as Record<string, unknown> | undefined)?.name)
  );

  /*
   * The response shape is the privacy boundary, so it is worth
   * asserting rather than assuming. A visitor holds a slug and
   * a rendering and no identifier that means anything anywhere
   * else in this system.
   */
  const leaked = [owner.id, agentId, String(row?.deployment_id ?? ""), String(row?.id ?? "")]
    .filter(Boolean)
    .filter((value) => openPage.raw.includes(value));

  check(
    "the public response leaks no ids",
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(", ")}` : "no user, agent, deployment or site id"
  );

  check(
    "and no model, provider or instructions",
    !/neurolink-1|groq|cloudflare|openrouter|mistral|system_instructions|test fixture/i.test(
      openPage.raw
    ),
    "runtime details withheld"
  );

  check(
    "chatLive is true for a ready agent",
    openPage.body.chatLive === true,
    String(openPage.body.chatLive)
  );

  section("Address collisions");

  const otherAgent = await makeAgent(other, "Other StudyBuddy", "ready");

  await owned(other.token, "POST", `/${otherAgent}/deployment`, {});

  const clash = await owned(other.token, "POST", `/${otherAgent}/site`, {
    slug: "studybuddy-verify",
  });

  const clashSlug = String(siteOf(clash).slug ?? "");

  check(
    "a second learner asking for a taken address gets a different one",
    clash.status === 201 && clashSlug !== "" && clashSlug !== slug,
    clashSlug || `status ${clash.status}`
  );

  check(
    "and both pages exist",
    Boolean(
      (await admin.from("agent_sites").select("id").eq("slug", slug).maybeSingle()).data
    ) &&
      Boolean(
        (await admin.from("agent_sites").select("id").eq("slug", clashSlug).maybeSingle())
          .data
      ),
    `${slug} and ${clashSlug}`
  );

  const reserved = await owned(owner.token, "GET", `/${agentId}/site/slug?value=login`);

  check(
    "a reserved address reports unavailable",
    reserved.body.available === false,
    String(reserved.body.reason ?? "")
  );

  const taken = await owned(
    owner.token,
    "GET",
    `/${agentId}/site/slug?value=${clashSlug}`
  );

  check(
    "a taken address reports unavailable",
    taken.body.available === false,
    String(taken.body.reason ?? "")
  );

  const ownAddress = await owned(owner.token, "GET", `/${agentId}/site/slug?value=${slug}`);

  check(
    "but a page's own address is available to itself",
    ownAddress.body.available === true,
    "renaming to the same address is not a collision"
  );

  section("Editing reaches the live page");

  const edited = await owned(owner.token, "PATCH", `/${agentId}/site`, {
    config: {
      ...storedConfig,
      hero: {
        ...(storedConfig.hero as Record<string, unknown>),
        headline: "Changed by the verifier",
      },
      theme: { ...(storedConfig.theme as Record<string, unknown>), mode: "dark" },
    },
  });

  check("a save returns the updated page", edited.status === 200, `status ${edited.status}`);

  const afterEdit = await publicGet(`/${slug}`);
  const liveConfig = (afterEdit.body.config ?? {}) as Record<string, unknown>;
  const liveHero = (liveConfig.hero ?? {}) as Record<string, unknown>;
  const liveTheme = (liveConfig.theme ?? {}) as Record<string, unknown>;

  check(
    "the change is on the public page immediately",
    liveHero.headline === "Changed by the verifier" && liveTheme.mode === "dark",
    `${String(liveHero.headline)} / ${String(liveTheme.mode)}`
  );

  section("Renaming");

  const renamed = await owned(owner.token, "PATCH", `/${agentId}/site`, {
    slug: "studybuddy-moved",
  });

  check("the rename succeeds", renamed.status === 200, `status ${renamed.status}`);

  const atOld = await publicGet(`/${slug}`);
  const atNew = await publicGet("/studybuddy-moved");

  check("the old address stops serving", atOld.status === 404, `status ${atOld.status}`);
  check("the new address serves", atNew.status === 200, `status ${atNew.status}`);

  section("Hiding and demoting");

  await owned(owner.token, "PATCH", `/${agentId}/site`, { published: false });

  const hidden = await publicGet("/studybuddy-moved");

  check("an unpublished page is a 404", hidden.status === 404, `status ${hidden.status}`);

  const ownerStillSees = await owned(owner.token, "GET", `/${agentId}/site`);

  check(
    "but its owner still sees it, with the address kept",
    String(siteOf(ownerStillSees).slug) === "studybuddy-moved" &&
      siteOf(ownerStillSees).published === false,
    "hidden, not deleted"
  );

  await owned(owner.token, "PATCH", `/${agentId}/site`, { published: true });

  /* Demoting the agent withdraws it from every door at once —
     the same gate authenticateDeployment applies. */
  await admin.from("agents").update({ status: "draft" }).eq("id", agentId);

  const demoted = await publicGet("/studybuddy-moved");

  check(
    "a page whose agent is a draft still renders",
    demoted.status === 200,
    `status ${demoted.status}`
  );

  check(
    "but its chat reports itself as not live",
    demoted.body.chatLive === false,
    String(demoted.body.chatLive)
  );

  const refusedChat = await fetch(`${API}/api/sites/studybuddy-moved/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });

  check(
    "and the chat endpoint refuses",
    refusedChat.status === 404,
    `status ${refusedChat.status}`
  );

  await admin.from("agents").update({ status: "ready" }).eq("id", agentId);

  section("Isolation");

  const anon = createClient(serverEnv.SUPABASE_URL, webEnv.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${other.token}` } },
  });

  const { data: seen } = await anon
    .from("agent_sites")
    .select("id, slug")
    .eq("slug", "studybuddy-moved");

  check(
    "RLS hides another learner's page row",
    !seen || seen.length === 0,
    seen?.length ? `SAW ${seen.length} row(s)` : "not visible"
  );

  const crossRead = await owned(other.token, "GET", `/${agentId}/site`);

  check(
    "and the owner API refuses another learner's agent",
    crossRead.status === 404,
    `status ${crossRead.status}`
  );

  const crossWrite = await owned(other.token, "PATCH", `/${agentId}/site`, {
    slug: "hijacked-verify",
  });

  check(
    "a cross-owner write is refused",
    crossWrite.status === 404,
    `status ${crossWrite.status}`
  );

  const stillMine = await publicGet("/studybuddy-moved");

  check(
    "and changed nothing",
    stillMine.status === 200,
    `status ${stillMine.status}`
  );

  section("Draft agents and cascade");

  const draftDeployment = await owned(
    owner.token,
    "POST",
    `/${draftAgent}/deployment`,
    {}
  );

  check(
    "a draft agent cannot be deployed, so it cannot have a page",
    draftDeployment.status >= 400,
    `status ${draftDeployment.status}`
  );

  /* Removing the deployment must take the page with it, or an
     undeployed agent would leave a public URL still answering. */
  const removed = await owned(owner.token, "DELETE", `/${agentId}/deployment`);

  check("the deployment is removed", removed.status === 200, `status ${removed.status}`);

  const { data: orphan } = await admin
    .from("agent_sites")
    .select("id")
    .eq("slug", "studybuddy-moved")
    .maybeSingle();

  check(
    "the page row is cascaded away with it",
    !orphan,
    orphan ? "ORPHANED — a public URL outlived its deployment" : "gone"
  );

  const afterCascade = await publicGet("/studybuddy-moved");

  check(
    "and the address stops serving",
    afterCascade.status === 404,
    `status ${afterCascade.status}`
  );

  section("Cleanup");

  for (const learner of [owner, other]) {
    const gone = await adminClient().auth.admin.deleteUser(learner.id);

    check(
      `the test learner ${learner.email.split("@")[0]} is deleted`,
      !gone.error,
      gone.error?.message ?? "removed"
    );
  }

  const { count } = await admin
    .from("agent_sites")
    .select("id", { count: "exact", head: true })
    .in("user_id", [owner.id, other.id]);

  check(
    "no page rows are left behind",
    (count ?? 0) === 0,
    `${count ?? 0} remaining`
  );
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  const pureOnly = process.argv.includes("--pure");

  console.log("\nBuildGentic — Phase 2.7 published agent pages");
  console.log(pureOnly ? "Pure checks only (no server needed)" : "");

  checkSlugDerivation();
  checkSlugRules();
  checkSlugCollisions();
  checkSchemaAcceptance();
  checkSchemaRefusal();
  checkEditParsing();
  checkEditApplying();

  if (!pureOnly) {
    const applied = await checkSchemaApplied();

    if (!applied) {
      console.log(
        "\n  Migration 0013 is not applied. Paste\n" +
          "  supabase/migrations/0013_agent_sites.sql into the Supabase SQL\n" +
          "  Editor, then re-run. Skipping the endpoint checks."
      );
    } else {
      await checkPublicEndpoint();

      if (!webEnv.VITE_SUPABASE_ANON_KEY) {
        console.log(
          "\n  .env.local has no VITE_SUPABASE_ANON_KEY, so the\n" +
            "  persistence checks cannot sign a learner in. Skipping."
        );
      } else {
        const owner = await makeLearner("owner");
        const other = await makeLearner("other");

        console.log(
          `\nTest learners: ${owner.email}\n               ${other.email}`
        );

        await checkLivePersistence(owner, other);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
