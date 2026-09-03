import type { ConceptStep as ConceptStepType } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ConceptVisual from "./ConceptVisual";

export default function ConceptStep({ step }: StepProps<ConceptStepType>) {
  return (
    <>
      {step.typeLabel ? (
        <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
          {step.typeLabel}
        </div>
      ) : null}

      <h1 className="focus__step-title">{step.title}</h1>

      {step.content ? <div className="prose">{step.content}</div> : null}

      {/*
        The diagram sits between the explanation and the
        examples: it summarises what was just said, and the
        examples then ground it in specifics.
      */}
      {step.visual ? <ConceptVisual visual={step.visual} /> : null}

      {step.examples?.length ? (
        <div
          className="stack gap-3"
          style={{ marginTop: "var(--space-6)", maxWidth: "var(--measure)" }}
        >
          {step.examples.map((example) => (
            <div
              key={example.id}
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--rule)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--text-base)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--ink)",
                  marginBottom: "var(--space-2)",
                }}
              >
                {example.title}
              </div>

              <p
                style={{
                  fontSize: "var(--text-sm)",
                  lineHeight: "var(--leading-snug)",
                  color: "var(--ink-secondary)",
                }}
              >
                {example.description}
              </p>

              {example.input || example.output ? (
                <div
                  className="stack gap-2"
                  style={{ marginTop: "var(--space-3)" }}
                >
                  {example.input ? (
                    <div>
                      <div className="meta">input</div>
                      <pre className="code" style={{ whiteSpace: "pre-wrap" }}>
                        {example.input}
                      </pre>
                    </div>
                  ) : null}

                  {example.output ? (
                    <div>
                      <div className="meta">output</div>
                      <pre className="code" style={{ whiteSpace: "pre-wrap" }}>
                        {example.output}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {step.misconception ? (
        <div style={{ marginTop: "var(--space-6)", maxWidth: "var(--measure)" }}>
          <Callout tone="caution" title="A common misunderstanding">
            {step.misconception}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
