import { Check, X } from "lucide-react";

import type { InteractiveOption } from "../../../../core/curriculum/Lesson";

interface OptionListProps {
  name: string;
  options: InteractiveOption[];
  selectedId: string | null;
  /* Once true, correct and incorrect answers are marked. */
  revealed?: boolean;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

/*
 * Single-choice option list.
 *
 * Real radio inputs rather than clickable divs, so arrow-key
 * navigation and screen readers work without extra handling.
 */
export default function OptionList({
  name,
  options,
  selectedId,
  revealed = false,
  disabled = false,
  onSelect,
}: OptionListProps) {
  return (
    <div className="options" role="radiogroup">
      {options.map((option) => {
        const isSelected = option.id === selectedId;

        let modifier = "";
        if (revealed && option.isCorrect) {
          modifier = " option--correct";
        } else if (revealed && isSelected && !option.isCorrect) {
          modifier = " option--wrong";
        } else if (isSelected) {
          modifier = " option--selected";
        }

        return (
          <label key={option.id} className={`option${modifier}`}>
            <input
              type="radio"
              name={name}
              className="option__input"
              value={option.id}
              checked={isSelected}
              disabled={disabled}
              onChange={() => onSelect(option.id)}
            />

            <span className="option__marker" aria-hidden="true">
              {revealed && option.isCorrect ? (
                <Check size={13} />
              ) : revealed && isSelected ? (
                <X size={13} />
              ) : null}
            </span>

            <span className="option__label">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
