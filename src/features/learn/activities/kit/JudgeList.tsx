import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

export interface JudgeOption {
  id: string;
  label: string;
}

export interface JudgeCase {
  id: string;
  /* Whatever the learner is judging — a claim, a log, an output. */
  body: ReactNode;
  title?: string;
  options: JudgeOption[];
  correctOptionId: string;
  explanation?: string;
}

interface JudgeListProps {
  cases: JudgeCase[];
  /* caseId → optionId */
  verdicts: Record<string, string>;
  revealed: boolean;
  disabled?: boolean;
  legend: string;
  onJudge: (caseId: string, optionId: string) => void;
}

/*
 * Judge each case, then see whether you were right and why.
 *
 * Shared by every activity where the learner reviews something
 * and reaches a verdict — fact checking, triaging model output,
 * classifying a bias incident, grading a prediction.
 */
export default function JudgeList({
  cases,
  verdicts,
  revealed,
  disabled = false,
  legend,
  onJudge,
}: JudgeListProps) {
  return (
    <div className="claims">
      {cases.map((item) => {
        const chosen = verdicts[item.id];
        const isCorrect = chosen === item.correctOptionId;

        let modifier = "";
        if (revealed && chosen) {
          modifier = isCorrect ? " claim--correct" : " claim--wrong";
        }

        return (
          <div key={item.id} className={`claim${modifier}`}>
            {item.title ? (
              <div className="sort-card__title" style={{ marginBottom: 4 }}>
                {item.title}
              </div>
            ) : null}

            <div className="claim__text">{item.body}</div>

            <div
              className="sorter__choices"
              role="radiogroup"
              aria-label={`${legend} for ${item.title ?? item.id}`}
            >
              {item.options.map((option) => {
                const selected = chosen === option.id;
                const isAnswer = revealed && option.id === item.correctOptionId;

                let chipModifier = "";
                if (isAnswer) {
                  chipModifier = " chip--answer";
                } else if (selected) {
                  chipModifier = revealed ? " chip--wrong" : " chip--selected";
                }

                return (
                  <label key={option.id} className={`chip${chipModifier}`}>
                    <input
                      type="radio"
                      className="chip__input"
                      name={`judge-${item.id}`}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => onJudge(item.id, option.id)}
                    />
                    {isAnswer ? <Check size={13} aria-hidden="true" /> : null}
                    {revealed && selected && !isCorrect ? (
                      <X size={13} aria-hidden="true" />
                    ) : null}
                    {option.label}
                  </label>
                );
              })}
            </div>

            {revealed && item.explanation ? (
              <p className="sort-card__why">{item.explanation}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
