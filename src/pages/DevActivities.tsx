import { useMemo, useState } from "react";

import { allLessons } from "../core/curriculum/registry";
import type { ActivityState, ActivityStep } from "../core/curriculum/Lesson";
import { useSurface } from "../components/Surface";
import { Badge } from "../components/ui";

import "../features/learn/activities/register";
import { registeredActivityTypes } from "../features/learn/activityRegistry";
import { evaluateAttempt } from "../features/learn/completion";
import type { AttemptResult } from "../features/learn/completion";
import ActivityHost from "../features/learn/steps/ActivityHost";

/*
 * Developer gallery — every interactive activity, rendered with
 * the real curriculum data that drives it in a lesson.
 *
 * Mounted only under `import.meta.env.DEV`, and outside the auth
 * gate, so every activity can be exercised without walking the
 * courses to reach them. Not part of the product.
 *
 * Reads the registry rather than one course, so an activity
 * authored in any course shows up here — which is the point,
 * since a payload that renders wrong is much cheaper to find on
 * this page than three lessons into a course.
 */
export default function DevActivities() {
  useSurface("learn");

  const [states, setStates] = useState<Record<string, ActivityState>>({});

  const activities = useMemo(() => {
    const found: { lessonTitle: string; step: ActivityStep }[] = [];

    allLessons.forEach((lesson) => {
      lesson.steps.forEach((step) => {
        if (step.type === "activity") {
          found.push({
            lessonTitle: `${lesson.courseId} · ${lesson.title}`,
            step,
          });
        }
      });
    });

    return found;
  }, []);

  const registered = new Set(registeredActivityTypes());

  function progressFor(step: ActivityStep) {
    return (result: AttemptResult) => {
      setStates((current) => ({
        ...current,
        [step.id]: evaluateAttempt(step.completion, current[step.id], result),
      }));
    };
  }

  return (
    <div className="page page--wide">
      <header className="page__header">
        <h1 className="page__title">Activity gallery</h1>
        <p className="page__lede">
          {activities.length} activities, {registered.size} registered
          interactive types. Development only.
        </p>
      </header>

      <div className="stack gap-7">
        {activities.map(({ lessonTitle, step }) => (
          <section key={step.id} id={step.id}>
            <div
              className="row gap-3"
              style={{ marginBottom: "var(--space-4)", flexWrap: "wrap" }}
            >
              <Badge tone="accent" mono>
                {step.interactiveType}
              </Badge>
              <span className="meta">{lessonTitle}</span>
              {registered.has(step.interactiveType) ? null : (
                <Badge tone="error">not registered</Badge>
              )}
              {states[step.id]?.completed ? (
                <Badge tone="correct">completed</Badge>
              ) : null}
            </div>

            <ActivityHost
              step={step}
              state={states[step.id]}
              onProgress={progressFor(step)}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
