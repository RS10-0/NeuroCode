import { Check, X } from "lucide-react";

export interface SortItem {
  id: string;
  title: string;
  description?: string;
  correctBucketId: string;
  explanation?: string;
}

export interface SortBucket {
  id: string;
  label: string;
  description?: string;
}

interface CardSorterProps {
  items: SortItem[];
  buckets: SortBucket[];
  /* itemId → bucketId */
  assignments: Record<string, string>;
  revealed: boolean;
  disabled?: boolean;
  onAssign: (itemId: string, bucketId: string) => void;
  /* Overrides the bucket label used in the choice row. */
  bucketLabel?: (bucket: SortBucket) => string;
}

/*
 * Assign each card to a bucket.
 *
 * Click-to-choose rather than drag and drop: dragging is
 * unusable on a phone, invisible to a keyboard, and this
 * curriculum runs its sorting activities on both. Each card
 * carries a real radio group, so arrow keys work for free.
 */
export default function CardSorter({
  items,
  buckets,
  assignments,
  revealed,
  disabled = false,
  onAssign,
  bucketLabel,
}: CardSorterProps) {
  return (
    <div className="sorter">
      {items.map((item) => {
        const chosen = assignments[item.id];
        const isCorrect = chosen === item.correctBucketId;

        let modifier = "";
        if (revealed && chosen) {
          modifier = isCorrect ? " sort-card--correct" : " sort-card--wrong";
        }

        return (
          <div key={item.id} className={`sort-card${modifier}`}>
            <div className="sort-card__head">
              <div className="sort-card__body">
                <div className="sort-card__title">{item.title}</div>
                {item.description ? (
                  <p className="sort-card__desc">{item.description}</p>
                ) : null}
              </div>

              {revealed && chosen ? (
                <span
                  className={
                    isCorrect ? "sort-card__mark" : "sort-card__mark sort-card__mark--wrong"
                  }
                  aria-hidden="true"
                >
                  {isCorrect ? <Check size={14} /> : <X size={14} />}
                </span>
              ) : null}
            </div>

            <div
              className="sorter__choices"
              role="radiogroup"
              aria-label={`Category for ${item.title}`}
            >
              {buckets.map((bucket) => {
                const selected = chosen === bucket.id;
                const isAnswer = revealed && bucket.id === item.correctBucketId;

                let chipModifier = "";
                if (isAnswer) {
                  chipModifier = " chip--answer";
                } else if (selected) {
                  chipModifier = revealed ? " chip--wrong" : " chip--selected";
                }

                return (
                  <label key={bucket.id} className={`chip${chipModifier}`}>
                    <input
                      type="radio"
                      className="chip__input"
                      name={`sort-${item.id}`}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => onAssign(item.id, bucket.id)}
                    />
                    {bucketLabel ? bucketLabel(bucket) : bucket.label}
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
