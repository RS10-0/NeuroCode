import { useMemo, useState } from "react";

import type { VectorSimilarityActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

export default function VectorSimilarityActivity({
  step,
  state,
  onProgress,
}: StepProps<VectorSimilarityActivityStep>) {
  const activity = step as VectorSimilarityActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [selected, setSelected] = useState<string[]>([]);
  /* Pairs the learner has compared, as "a|b" with ids sorted. */
  const [compared, setCompared] = useState<string[]>([]);

  const bounds = useMemo(() => {
    const xs = activity.points.map((point) => point.x);
    const ys = activity.points.map((point) => point.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [activity.points]);

  /* Normalise into the plot box with a margin so labels fit. */
  function position(value: number, min: number, max: number): number {
    const span = max - min || 1;
    return 10 + ((value - min) / span) * 80;
  }

  const [firstId, secondId] = selected;
  const first = activity.points.find((point) => point.id === firstId);
  const second = activity.points.find((point) => point.id === secondId);

  const similarity = useMemo(() => {
    if (!first || !second) {
      return undefined;
    }

    if (activity.similarityMetric === "cosine") {
      const dot = first.x * second.x + first.y * second.y;
      const magnitude =
        Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);

      return magnitude === 0 ? 0 : dot / magnitude;
    }

    /* Euclidean, mapped so nearer reads as more similar. */
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const diagonal = Math.hypot(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY
    );

    return diagonal === 0 ? 1 : 1 - distance / diagonal;
  }, [activity.similarityMetric, bounds, first, second]);

  const expected = useMemo(() => {
    if (!first || !second) {
      return undefined;
    }

    return activity.targetPairs?.find(
      (pair) =>
        (pair.firstId === first.id && pair.secondId === second.id) ||
        (pair.firstId === second.id && pair.secondId === first.id)
    );
  }, [activity.targetPairs, first, second]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((value) => value !== id);
      }

      const next = current.length >= 2 ? [current[1], id] : [...current, id];

      if (next.length === 2) {
        const key = [...next].sort().join("|");
        setCompared((seen) => (seen.includes(key) ? seen : [...seen, key]));
      }

      return next;
    });
  }

  const required = activity.targetPairs?.length ?? 3;
  const enough = compared.length >= Math.min(required, 3);

  function check() {
    run.check({
      completed: enough,
      score: scoreOf(compared.length, required),
      correctActions: compared.length,
      totalActions: required,
      actions: compared,
    });
  }

  return (
    <>
      <p className="activity-note">
        Every word sits somewhere in this space. Click two of them to see how
        close they are — the model has no dictionary, only these distances.
      </p>

      <div className="scatter">
        {first && second ? (
          <span
            className="scatter__line"
            style={{
              left: `${position(first.x, bounds.minX, bounds.maxX)}%`,
              top: `${100 - position(first.y, bounds.minY, bounds.maxY)}%`,
              width: `${Math.hypot(
                position(second.x, bounds.minX, bounds.maxX) -
                  position(first.x, bounds.minX, bounds.maxX),
                position(second.y, bounds.minY, bounds.maxY) -
                  position(first.y, bounds.minY, bounds.maxY)
              )}%`,
              transform: `rotate(${Math.atan2(
                position(first.y, bounds.minY, bounds.maxY) -
                  position(second.y, bounds.minY, bounds.maxY),
                position(second.x, bounds.minX, bounds.maxX) -
                  position(first.x, bounds.minX, bounds.maxX)
              )}rad)`,
            }}
          />
        ) : null}

        {activity.points.map((point) => {
          const isSelected = selected.includes(point.id);
          const left = position(point.x, bounds.minX, bounds.maxX);

          return (
            <button
              key={point.id}
              type="button"
              className={
                isSelected
                  ? "scatter__point scatter__point--selected"
                  : "scatter__point"
              }
              style={{
                left: `${left}%`,
                top: `${100 - position(point.y, bounds.minY, bounds.maxY)}%`,
                /*
                 * Anchored in proportion to where the point sits,
                 * rather than centred on it.
                 *
                 * A centred pill hangs half its width past its
                 * own coordinate, so a wide label on a point near
                 * either edge left the plot entirely. Sliding the
                 * anchor from its left edge to its right edge as
                 * the point crosses the plot keeps the pill
                 * inside for any label the max-width allows: at
                 * 10% it sits almost entirely to the right of the
                 * point, at 90% almost entirely to the left, and
                 * in the middle it is centred exactly as before.
                 */
                transform: `translate(-${left}%, -50%)`,
              }}
              aria-pressed={isSelected}
              disabled={run.checked}
              onClick={() => toggle(point.id)}
            >
              <span className="scatter__dot" aria-hidden="true" />
              {point.label}
            </button>
          );
        })}
      </div>

      {first && second && similarity !== undefined ? (
        <div className="activity-group">
          <div className="activity-group__title">
            {first.label} and {second.label}
          </div>

          <div className="readout">
            <div className="readout__head">
              <span className="meta">{activity.similarityMetric} similarity</span>
              <span className="readout__value">{similarity.toFixed(2)}</span>
            </div>

            <div className="readout__bar">
              <span
                className="readout__fill"
                style={{ width: `${Math.max(0, similarity) * 100}%` }}
              />
            </div>
          </div>

          <p className="readout__detail">
            {expected
              ? expected.expectedRelationship === "similar"
                ? "These sit close together because they get used in the same kinds of sentences."
                : "These sit far apart — they rarely appear in similar contexts."
              : (first.explanation ??
                second.explanation ??
                "Position here comes from how these words are used, not from what they mean to you.")}
          </p>
        </div>
      ) : (
        <p className="slider__hint" style={{ marginTop: "var(--space-4)" }}>
          Select two words to compare them.
        </p>
      )}

      <ActivityActions
        checked={run.checked}
        canCheck={enough}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Done comparing"
        onCheck={check}
        onReset={() => {
          run.reset();
          setSelected([]);
          setCompared([]);
        }}
      />

      {!run.checked && !enough ? (
        <p className="slider__hint">
          Compare {Math.min(required, 3) - compared.length} more{" "}
          {Math.min(required, 3) - compared.length === 1 ? "pair" : "pairs"}.
        </p>
      ) : null}

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone="correct" title="Meaning as geometry">
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "Words that get used the same way end up near each other. That is the entire mechanism behind a model appearing to know that a cat is more like a dog than like a spreadsheet."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
