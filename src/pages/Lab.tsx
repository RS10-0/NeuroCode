import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Callout, Skeleton } from "../components/ui";
import { useAuth } from "../auth/useAuth";
import type {
  AiModel,
  AiRuntimeInfo,
  AiUsageReport,
} from "../lib/aiClient";

import LabShell from "../features/lab/LabShell";
import NeuralResponse from "../features/lab/NeuralResponse";
import ParameterControls from "../features/lab/ParameterControls";
import PromptWorkspace from "../features/lab/PromptWorkspace";
import RunHistoryDrawer from "../features/lab/RunHistoryDrawer";
import { UsageMeters } from "../features/lab/UsageMeters";
import UnderTheHood from "../features/lab/UnderTheHood";
import WhatChanged from "../features/lab/WhatChanged";
import type { LabPreset } from "../features/lab/presets";
import { clearHistory, loadHistory, saveHistory } from "../features/lab/history";
import { hasErrors, previewJson, validate } from "../features/lab/request";
import { useAiRuntime } from "../features/lab/useAiRuntime";
import { useCredits } from "../features/credits/useCredits";
import { useLabRun } from "../features/lab/useLabRun";
import type { LabRun, LabSettings } from "../features/lab/types";

/*
 * The AI Lab.
 *
 * One of BuildGentic's two AI surfaces, and deliberately one of
 * only two. Courses, lessons, quizzes, progress, XP and the
 * dashboard are all deterministic application logic and none of
 * them calls a model; a learner's progress must not depend on
 * whether a provider is having a bad afternoon. The Lab is
 * where a model is the point.
 *
 * It is also not a chat window. A chat window teaches that
 * prompting is a knack you either have or do not. What this
 * page is built to teach is that a request is a structure —
 * system instructions, one message, a model, three parameters —
 * that each part has an observable effect, and that the effect
 * costs a measurable number of tokens. Hence the two equal
 * cards, the telemetry strip, "What Changed?", and a log that
 * says what moved between two runs rather than just listing
 * them.
 *
 * Everything below goes through the Phase 2.1 runtime at
 * /api/ai/chat. This page holds no provider name it did not
 * read from the server, no key, and no model list of its own.
 *
 * The page is split in two on purpose. The shell below owns
 * loading and failure; the workbench underneath it only ever
 * exists once there is a real catalogue and a real learner to
 * build from — so its opening model, temperature and output cap
 * come from the server in its initial state rather than being
 * guessed and then corrected by an effect a render later.
 */

export default function Lab() {
  const { user } = useAuth();
  const runtime = useAiRuntime();

  if (runtime.loading && !runtime.info) {
    return (
      <div className="page page--flush labsurface">
        <div className="labboot">
          <Skeleton width="220px" height="34px" />
          <Skeleton width="100%" height="120px" />
          <Skeleton width="100%" height="280px" />
        </div>
      </div>
    );
  }

  if (!runtime.info) {
    return (
      <div className="page page--flush labsurface">
        <div className="labboot">
          <h1 className="lab-title">AI Lab</h1>

          <Callout
            tone="error"
            title="The Lab could not reach BuildGentic's AI runtime"
          >
            {runtime.error?.message ??
              "The model catalogue could not be loaded. Reload the page to try again."}
          </Callout>
        </div>
      </div>
    );
  }

  return (
    <Workbench
      /* Remounting on a change of learner is what clears one
         person's tab-local history out of the next person's
         Lab, with no effect to keep in step. */
      key={user?.id ?? "anonymous"}
      userId={user?.id ?? ""}
      info={runtime.info}
      usage={runtime.usage}
      refreshUsage={runtime.refreshUsage}
    />
  );
}

/* =========================================================
   WORKBENCH
========================================================= */

interface WorkbenchProps {
  userId: string;
  info: AiRuntimeInfo;
  usage: AiUsageReport | null;
  refreshUsage: () => Promise<void>;
}

/*
 * Where the catalogue's own defaults become the opening state.
 *
 * Temperature and the output cap are the server's numbers for
 * the model it would have picked anyway — so a learner who
 * changes nothing and presses Run gets exactly what the runtime
 * would have done on its own, and the controls agree with it.
 */
function initialSettings(info: AiRuntimeInfo): LabSettings {
  const first =
    info.models.find((entry) => entry.id === info.defaultModel) ??
    info.models[0];

  return {
    system: "",
    prompt: "",
    temperature: first?.defaultTemperature ?? 0.7,
    maxOutputTokens: first?.defaultMaxOutputTokens ?? 512,
    stop: [],
  };
}

function Workbench({
  userId,
  info,
  usage,
  refreshUsage,
}: WorkbenchProps) {
  const [settings, setSettings] = useState<LabSettings>(() =>
    initialSettings(info)
  );

  const { credits, canAfford, refresh: refreshCredits } = useCredits();

  /* Tab-local, per learner. See features/lab/history.ts for why
     this is deliberately not stored on the server. */
  const [runs, setRuns] = useState<LabRun[]>(() => loadHistory(userId));

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState<LabPreset | null>(null);

  const recordRun = useCallback(
    (entry: LabRun) => {
      setActiveRunId(entry.id);

      setRuns((current) => {
        const next = [entry, ...current];

        if (userId) {
          saveHistory(userId, next);
        }

        return next;
      });
    },
    [userId]
  );

  const { state: runState, run, stop } = useLabRun({ onFinished: recordRun });

  const streaming = runState.phase === "streaming";

  /* ---------------------------------------------------------
     THE MODEL

     One entry, chosen by the server. What used to be here — a
     catalogue that changed under the learner whenever they
     switched power source — went with BYOK.
     --------------------------------------------------------- */

  const models: AiModel[] = info.models;

  const model = useMemo(
    () =>
      models.find((entry) => entry.id === info.defaultModel) ?? models[0],
    [models, info.defaultModel]
  );

  const limits = info.limits;

  const errors = validate(settings, model, limits, info.requestLimits);

  /*
   * The XP pre-check.
   *
   * Advisory only — `spend_credits` inside the request is what
   * actually refuses, and it is the one that counts. This exists
   * so a learner who cannot afford a run sees a disabled button
   * and a sentence explaining why, rather than pressing it and
   * waiting for a round trip to say no.
   *
   * Optimistic while the balance is loading: a meter that has
   * not arrived must not disable the product.
   */
  const labCost = credits?.costs.lab ?? 1;
  const affordable = canAfford(labCost);

  const canRun =
    !streaming && models.length > 0 && !hasErrors(errors) && affordable;

  /* ---------------------------------------------------------
     ACTIONS
     --------------------------------------------------------- */

  const patch = useCallback((next: Partial<LabSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    /* The workspace no longer matches the highlighted run. */
    setActiveRunId(null);
  }, []);

  async function launch() {
    if (!canRun) {
      return;
    }

    await run(settings);

    /* The meters have to move the moment a run lands, or they
       read as broken. */
    void refreshUsage();

    /* And the wallet, which just went down by the cost of this
       run — or back up, if every provider was down. */
    void refreshCredits();
  }

  function applyPreset(entry: LabPreset) {
    setPreset(entry);
    setActiveRunId(null);

    setSettings((current) => ({
      ...current,
      ...entry.settings,
      /* Clamp to what the selected model actually allows. */
      maxOutputTokens: model
        ? Math.min(entry.settings.maxOutputTokens, model.maxOutputTokens)
        : entry.settings.maxOutputTokens,
    }));
  }

  function restore(entry: LabRun) {
    setSettings(entry.settings);
    setActiveRunId(entry.id);
    setPreset(null);
    setHistoryOpen(false);
  }

  function wipeHistory() {
    clearHistory();
    setRuns([]);
    setActiveRunId(null);
    setHistoryOpen(false);
  }

  /*
   * Export Config.
   *
   * Exactly the body the Lab would POST — the same
   * `previewJson` shown under "Raw JSON", so what leaves in the
   * file and what leaves on the wire cannot describe two
   * different requests. Purely client-side: nothing is uploaded
   * and nothing new is recorded.
   */
  function exportConfig() {
    const blob = new Blob([previewJson(settings)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `buildgentic-experiment-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    /* Revoked on the next tick rather than immediately: Safari
       has not finished reading the blob when click() returns. */
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  return (
    /* Full-bleed inside the shell's main column, and the only
       place the Lab's warm palette applies — the global rail
       keeps BuildGentic's own. */
    <div className="page page--flush labsurface">
      <LabShell
        search={search}
        onSearch={setSearch}
        onOpenHistory={() => setHistoryOpen(true)}
        historyCount={runs.length}
        onExport={exportConfig}
        canExport={settings.prompt.trim().length > 0}
        aside={
          <>
            <ParameterControls
              settings={settings}
              model={model}
              errors={errors}
              disabled={streaming}
              onChange={patch}
            />

            <WhatChanged runs={runs} />

            <UnderTheHood
              settings={settings}
              model={model}
              limits={limits}
              state={runState}
            />
          </>
        }
      >
        <UsageMeters usage={usage} />

        {models.length === 0 ? (
          <Callout tone="caution" title="AI is unavailable">
            This BuildGentic server has no usable AI configured.
          </Callout>
        ) : !affordable ? (
          <Callout tone="caution" title="You are out of XP for today">
            Every experiment costs {labCost} XP, and your balance is spent.
            It refills tomorrow — or finish a lesson to earn{" "}
            {credits?.earnings.lessonComplete ?? 20} XP back right now.{" "}
            <Link to="/courses">Pick up where you left off</Link>.
          </Callout>
        ) : null}

        <PromptWorkspace
          settings={settings}
          requestLimits={info.requestLimits}
          errors={errors}
          streaming={streaming}
          canRun={canRun}
          activePreset={preset}
          onChange={patch}
          onPreset={applyPreset}
          onRun={() => void launch()}
          onStop={stop}
        />

        <NeuralResponse state={runState} onRetry={() => void launch()} />
      </LabShell>

      <RunHistoryDrawer
        open={historyOpen}
        runs={runs}
        activeId={activeRunId}
        search={search}
        onRestore={restore}
        onClear={wipeHistory}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
