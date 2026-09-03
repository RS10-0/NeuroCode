import type { IntroStep as IntroStepType } from "../../../core/curriculum/Lesson";
import type { StepProps } from "../types";

export default function IntroStep({ step }: StepProps<IntroStepType>) {
  return (
    <>
      <h1 className="focus__step-title">{step.title}</h1>

      {step.subtitle ? (
        <p
          className="prose"
          style={{
            fontSize: "var(--text-md)",
            marginBottom: "var(--space-5)",
          }}
        >
          {step.subtitle}
        </p>
      ) : null}

      {step.content ? <div className="prose">{step.content}</div> : null}

      {step.learningObjectives?.length ? (
        <div style={{ marginTop: "var(--space-6)" }}>
          <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
            by the end of this lesson
          </div>
          <ul className="prose">
            {step.learningObjectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
