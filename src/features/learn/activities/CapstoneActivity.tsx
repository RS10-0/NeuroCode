import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import type {
  CapstoneActivityStep,
  CapstoneStage,
} from "../../../core/curriculum/Lesson";
import { Button, Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import JudgeList from "./kit/JudgeList";
import ParameterSlider from "./kit/ParameterSlider";
import ScoreReadout from "./kit/ScoreReadout";
import { useActivityRun } from "./kit/useActivityRun";

const AUDIT_ACTIONS = [
  { id: "approve", label: "Approve" },
  { id: "regenerate", label: "Regenerate" },
  { id: "escalate", label: "Escalate" },
  { id: "block", label: "Block" },
];

export default function CapstoneActivity({
  step,
  state,
  onProgress,
}: StepProps<CapstoneActivityStep>) {
  const activity = step as CapstoneActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [stageIndex, setStageIndex] = useState(0);

  const [datasets, setDatasets] = useState<string[]>([]);
  const [promptElements, setPromptElements] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(
    activity.promptConfig.recommendedTemperature
  );
  const [auditVerdicts, setAuditVerdicts] = useState<Record<string, string>>({});
  const [flaggedTests, setFlaggedTests] = useState<string[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const [signoff, setSignoff] = useState<string[]>([]);

  const stage = activity.stages[stageIndex];

  /* ---------------------------------------------------------
     SCORING

     Each category is earned independently, then weighted into
     an overall figure the way the curriculum specifies.
     --------------------------------------------------------- */

  const scores = useMemo(() => {
    const goodDatasets = activity.datasets.filter((d) => d.recommended);
    const chosenGood = goodDatasets.filter((d) => datasets.includes(d.id)).length;
    const chosenBad = activity.datasets.filter(
      (d) => !d.recommended && datasets.includes(d.id)
    ).length;

    const accuracy = Math.max(
      0,
      Math.round(
        (chosenGood / Math.max(1, goodDatasets.length)) * 100 - chosenBad * 20
      )
    );

    const requiredPrompt = activity.promptConfig.systemPromptRequirements.filter(
      (r) => r.required
    );
    const metPrompt = requiredPrompt.filter((r) =>
      promptElements.includes(r.id)
    ).length;

    const auditCorrect = activity.auditCases.filter(
      (c) => auditVerdicts[c.id] === c.correctAction
    ).length;

    const safety = Math.round(
      ((metPrompt / Math.max(1, requiredPrompt.length)) * 50 +
        (auditCorrect / Math.max(1, activity.auditCases.length)) * 50)
    );

    const realDisparities = activity.fairnessTests.filter(
      (t) => t.disparityDetected
    );
    const caught = realDisparities.filter((t) => flaggedTests.includes(t.id)).length;
    const falseFlags = activity.fairnessTests.filter(
      (t) => !t.disparityDetected && flaggedTests.includes(t.id)
    ).length;

    const fairness = Math.max(
      0,
      Math.round(
        (caught / Math.max(1, realDisparities.length)) * 100 - falseFlags * 15
      )
    );

    const requiredPolicies = activity.deploymentPolicies.filter((p) => p.required);
    const metPolicies = requiredPolicies.filter((p) =>
      policies.includes(p.id)
    ).length;

    const userExperience = Math.round(
      (metPolicies / Math.max(1, requiredPolicies.length)) * 100
    );

    const weighting = activity.scoring.weighting;
    const totalWeight =
      weighting.accuracy +
      weighting.fairness +
      weighting.safety +
      weighting.userExperience;

    const overall = Math.round(
      (accuracy * weighting.accuracy +
        fairness * weighting.fairness +
        safety * weighting.safety +
        userExperience * weighting.userExperience) /
        Math.max(1, totalWeight)
    );

    return { accuracy, fairness, safety, userExperience, overall };
  }, [
    activity,
    datasets,
    promptElements,
    auditVerdicts,
    flaggedTests,
    policies,
  ]);

  const requiredSignoff = activity.finalSignoff.checklist.filter((r) => r.required);
  const signoffComplete = requiredSignoff.every((r) => signoff.includes(r.id));

  const passed =
    scores.overall >= activity.scoring.minimumOverallScore && signoffComplete;

  function toggle(
    setter: (updater: (current: string[]) => string[]) => void,
    id: string
  ) {
    setter((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  function check() {
    run.check({ completed: passed, score: scores.overall });
  }

  /* Stages the learner has done enough in to count as visited. */
  const stageDone: Record<CapstoneStage, boolean> = {
    data_selection: datasets.length > 0,
    model_training: datasets.length > 0,
    prompt_engineering: promptElements.length > 0,
    error_audit:
      Object.keys(auditVerdicts).length === activity.auditCases.length,
    bias_audit: flaggedTests.length > 0,
    responsible_deployment: policies.length > 0,
    final_signoff: signoffComplete,
  };

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">
          {activity.scenario.organization} — {activity.scenario.title}
        </div>

        <p className="activity-note">{activity.scenario.description}</p>

        <div className="preview-box">
          <strong>{activity.scenario.systemName}</strong>{" "}
          {activity.scenario.systemPurpose}
          <div style={{ marginTop: "var(--space-3)" }}>
            <div className="meta">known risks</div>
            <ul style={{ marginTop: "var(--space-2)" }}>
              {activity.scenario.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="stages">
        {activity.stages.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            className={[
              "stage",
              index === stageIndex ? "stage--active" : "",
              stageDone[candidate.stage] ? "stage--done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setStageIndex(index)}
          >
            <span className="stage__num">
              {stageDone[candidate.stage] ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
            {candidate.title}
          </button>
        ))}
      </div>

      <div className="activity-group">
        <div className="activity-group__title">{stage.title}</div>
        <p className="activity-note">{stage.description}</p>

        {stage.stage === "data_selection" ? (
          <div className="sorter">
            {activity.datasets.map((dataset) => {
              const selected = datasets.includes(dataset.id);

              let modifier = "";
              if (run.checked) {
                modifier =
                  dataset.recommended === selected
                    ? " sort-card--correct"
                    : selected
                      ? " sort-card--wrong"
                      : "";
              }

              return (
                <label key={dataset.id} className={`sort-card${modifier}`}>
                  <div className="sort-card__head">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={run.checked}
                      onChange={() => toggle(setDatasets, dataset.id)}
                      style={{ marginTop: 4 }}
                    />

                    <div className="sort-card__body">
                      <div className="sort-card__title">{dataset.name}</div>
                      <p className="sort-card__desc">{dataset.description}</p>

                      <div
                        className="row gap-2"
                        style={{ marginTop: "var(--space-2)", flexWrap: "wrap" }}
                      >
                        <span className="badge badge--neutral">
                          {dataset.sourceType}
                        </span>
                        <span
                          className={`badge ${
                            dataset.quality === "high"
                              ? "badge--correct"
                              : dataset.quality === "medium"
                                ? "badge--caution"
                                : "badge--error"
                          }`}
                        >
                          {dataset.quality} quality
                        </span>
                        {dataset.containsSensitiveData ? (
                          <span className="badge badge--error">sensitive</span>
                        ) : null}
                        {!dataset.balanced ? (
                          <span className="badge badge--caution">imbalanced</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {run.checked ? (
                    <p className="sort-card__why">{dataset.explanation}</p>
                  ) : null}
                </label>
              );
            })}
          </div>
        ) : null}

        {stage.stage === "model_training" ? (
          <ScoreReadout
            label="projected accuracy from your data"
            score={scores.accuracy}
            target={70}
            detail={
              datasets.length === 0
                ? "Pick datasets in the previous stage first."
                : "This is the ceiling your data sets. No amount of prompt work moves it."
            }
          />
        ) : null}

        {stage.stage === "prompt_engineering" ? (
          <>
            <div className="sorter__choices">
              {activity.promptConfig.systemPromptRequirements.map(
                (requirement) => {
                  const selected = promptElements.includes(requirement.id);

                  let modifier = "";
                  if (run.checked && requirement.required) {
                    modifier = selected ? " chip--answer" : " chip--wrong";
                  } else if (selected) {
                    modifier = " chip--selected";
                  }

                  return (
                    <label
                      key={requirement.id}
                      className={`chip${modifier}`}
                      title={requirement.description}
                    >
                      <input
                        type="checkbox"
                        className="chip__input"
                        checked={selected}
                        disabled={run.checked}
                        onChange={() => toggle(setPromptElements, requirement.id)}
                      />
                      {requirement.label}
                      {requirement.required ? " *" : ""}
                    </label>
                  );
                }
              )}
            </div>

            <div style={{ marginTop: "var(--space-5)" }}>
              <ParameterSlider
                label="Temperature"
                description="Medical guidance wants consistency, not variety."
                min={Math.min(...activity.promptConfig.temperatureOptions)}
                max={Math.max(...activity.promptConfig.temperatureOptions)}
                step={0.1}
                value={temperature}
                disabled={run.checked}
                hint={
                  temperature > activity.promptConfig.recommendedTemperature
                    ? "Higher than recommended — the same question will get different answers."
                    : undefined
                }
                onChange={setTemperature}
              />
            </div>
          </>
        ) : null}

        {stage.stage === "error_audit" ? (
          <JudgeList
            legend="Action"
            cases={activity.auditCases.map((auditCase) => ({
              id: auditCase.id,
              title: auditCase.userMessage,
              body: (
                <div className="preview-box">{auditCase.aiResponse}</div>
              ),
              options: AUDIT_ACTIONS,
              correctOptionId: auditCase.correctAction,
              explanation: auditCase.explanation,
            }))}
            verdicts={auditVerdicts}
            revealed={run.checked}
            disabled={run.checked}
            onJudge={(caseId, optionId) =>
              setAuditVerdicts((current) => ({ ...current, [caseId]: optionId }))
            }
          />
        ) : null}

        {stage.stage === "bias_audit" ? (
          <div className="sorter">
            {activity.fairnessTests.map((test) => {
              const flagged = flaggedTests.includes(test.id);

              let modifier = "";
              if (run.checked) {
                modifier =
                  test.disparityDetected === flagged
                    ? " sort-card--correct"
                    : " sort-card--wrong";
              }

              return (
                <label key={test.id} className={`sort-card${modifier}`}>
                  <div className="sort-card__head">
                    <input
                      type="checkbox"
                      checked={flagged}
                      disabled={run.checked}
                      onChange={() => toggle(setFlaggedTests, test.id)}
                      style={{ marginTop: 4 }}
                    />

                    <div className="sort-card__body">
                      <div className="sort-card__title">{test.group}</div>
                      <p className="sort-card__desc">{test.query}</p>

                      <div className="split" style={{ marginTop: "var(--space-3)" }}>
                        <div>
                          <div className="meta">expected</div>
                          <p className="sort-card__desc">{test.expectedOutcome}</p>
                        </div>
                        <div>
                          <div className="meta">observed</div>
                          <p className="sort-card__desc">{test.observedOutcome}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {run.checked && test.recommendedAdjustment ? (
                    <p className="sort-card__why">{test.recommendedAdjustment}</p>
                  ) : null}
                </label>
              );
            })}
          </div>
        ) : null}

        {stage.stage === "responsible_deployment" ? (
          <div className="sorter__choices">
            {activity.deploymentPolicies.map((policy) => {
              const selected = policies.includes(policy.id);

              let modifier = "";
              if (run.checked && policy.required) {
                modifier = selected ? " chip--answer" : " chip--wrong";
              } else if (selected) {
                modifier = " chip--selected";
              }

              return (
                <label
                  key={policy.id}
                  className={`chip${modifier}`}
                  title={
                    policy.required
                      ? `${policy.description} Without it: ${policy.consequenceIfMissing}`
                      : policy.description
                  }
                >
                  <input
                    type="checkbox"
                    className="chip__input"
                    checked={selected}
                    disabled={run.checked}
                    onChange={() => toggle(setPolicies, policy.id)}
                  />
                  {policy.label}
                  {policy.required ? " *" : ""}
                </label>
              );
            })}
          </div>
        ) : null}

        {stage.stage === "final_signoff" ? (
          <>
            <div className="stack gap-3">
              {activity.finalSignoff.checklist.map((requirement) => (
                <label
                  key={requirement.id}
                  className="row gap-3"
                  style={{ alignItems: "flex-start", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={signoff.includes(requirement.id)}
                    disabled={run.checked}
                    onChange={() => toggle(setSignoff, requirement.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-medium)",
                        color: "var(--ink)",
                      }}
                    >
                      {requirement.label}
                      {requirement.required ? " *" : ""}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--text-xs)",
                        color: "var(--ink-secondary)",
                      }}
                    >
                      {requirement.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <p className="activity-note" style={{ marginTop: "var(--space-4)" }}>
              {activity.finalSignoff.confirmationText}
            </p>
          </>
        ) : null}
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Review score</div>

        {activity.scoring.categories.map((category) => (
          <div key={category.id} style={{ marginBottom: "var(--space-3)" }}>
            <div className="readout__head">
              <span className="meta">{category.label}</span>
              <span className="readout__value">{scores[category.id]}</span>
            </div>
            <div className="readout__bar">
              <span
                className={
                  scores[category.id] >= 70
                    ? "readout__fill readout__fill--met"
                    : "readout__fill"
                }
                style={{ width: `${scores[category.id]}%` }}
              />
            </div>
          </div>
        ))}

        <ScoreReadout
          label="overall"
          score={scores.overall}
          target={activity.scoring.minimumOverallScore}
        />
      </div>

      {stageIndex < activity.stages.length - 1 ? (
        <Button variant="primary" onClick={() => setStageIndex(stageIndex + 1)}>
          Next stage
        </Button>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={signoffComplete}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit for review"
        onCheck={check}
        onReset={run.reset}
      />

      {!run.checked && !signoffComplete ? (
        <p className="slider__hint">
          Work through every stage and complete the sign-off checklist.
        </p>
      ) : null}

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={passed ? "correct" : "error"}
            title={passed ? "Approved for deployment" : "Sent back for rework"}
          >
            {passed
              ? activity.finalSignoff.successMessage
              : activity.finalSignoff.failureMessage}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
