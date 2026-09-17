import { useState } from "react";

import type { AiRequestLimits } from "../lib/aiClient";
import LabShell, { type WorkspaceId } from "../features/lab/LabShell";
import CompareBench from "../features/lab/compare/CompareBench";
import { useExperiment } from "../features/lab/compare/useExperiment";
import type { LabSettings } from "../features/lab/types";

/*
 * Developer harness — the Prompt Canvas.
 *
 * Mounted only under `import.meta.env.DEV` and outside the auth
 * gate, exactly like /dev/sites, /dev/activities and
 * /dev/flagships. Not part of the product, and tree shaken out
 * of a production build.
 *
 * It exists for the reason /dev/desks gives: reaching the real
 * screen costs an account, an onboarding and a signed-in
 * session, and that friction is how a workspace ends up shipping
 * with a control nobody ever looked at on a phone.
 *
 * WHAT IT CANNOT DO IS RUN ANYTHING, and that matters more here
 * than it did for the earlier version of this page. The bench's
 * whole point is two real answers side by side, and a request
 * needs a bearer token — so `canRun` is false and the button
 * says why. Everything up to pressing it is real: both
 * composers, the live diff between them, the challenge checks,
 * and the store surviving a reload.
 *
 * Supplied by hand: the server's character limits, the
 * catalogue's opening parameters, and a learner id of its own so
 * a developer poking at this cannot overwrite their own bench.
 */

/* The defaults from server/src/ai/config.ts. `maxMessages` is
   irrelevant here — a comparison is two single-turn requests —
   but it is part of the shape the real page receives. */
const LIMITS: AiRequestLimits = {
  maxMessages: 40,
  maxMessageChars: 12_000,
  maxSystemChars: 8_000,
};

/* What initialSettings() in pages/Lab.tsx would have produced
   from the catalogue. */
const OPENING: LabSettings = {
  system: "",
  prompt: "",
  temperature: 0.7,
  maxOutputTokens: 512,
  stop: [],
};

export default function DevCanvas() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("prompt-canvas");

  const experiment = useExperiment("dev-compare-harness", OPENING);

  return (
    <div className="page page--flush labsurface">
      <LabShell
        workspace={workspace}
        onWorkspace={setWorkspace}
        search=""
        onSearch={() => {}}
        onOpenHistory={() => {}}
        historyCount={0}
        onExport={() => {}}
        canExport={false}
        aside={null}
      >
        {workspace === "prompt-canvas" ? (
          <CompareBench
            api={experiment}
            requestLimits={LIMITS}
            canRun={false}
            blockedReason="This is the developer harness — running needs a signed-in learner. Open /lab to actually compare two answers."
            cost={2}
          />
        ) : (
          <p className="launch__note">
            The Playground needs a signed-in learner and a model catalogue.
            Open /lab for that.
          </p>
        )}
      </LabShell>
    </div>
  );
}
