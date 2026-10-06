import { useState, type FormEvent } from "react";

import { Button, Field, Select } from "../../components/ui";
import { bandFor, type AgeBand } from "./age";

/*
 * "When were you born?" — month and year, nothing else.
 *
 * A NEUTRAL age screen, which is what the FTC's COPPA guidance
 * asks for and why this looks the way it does:
 *
 *   It never mentions 13, or any age, or what happens next. A
 *   screen that says "you must be 13" teaches the answer.
 *
 *   The years run back far enough for anybody, with no default
 *   selected — a pre-filled year is a suggested year.
 *
 *   Only the band leaves this component. The month and year are
 *   turned into one here (age.ts) and discarded.
 *
 * Going back and answering again is handled by whoever renders
 * this (see rememberAnswer), not here.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function AgeQuestion({
  busy = false,
  submitLabel = "Continue",
  onAnswer,
}: {
  busy?: boolean;
  submitLabel?: string;
  onAnswer: (band: AgeBand) => void;
}) {
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState("");

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, index) => thisYear - index);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!month || !year) {
      setError("Choose the month and year you were born.");
      return;
    }

    setError("");
    onAnswer(bandFor({ month: Number(month), year: Number(year) }));
  };

  return (
    <form className="auth__form" onSubmit={handleSubmit} noValidate>
      <div className="age-question">
        <Field label="Month" error={error && !month ? error : undefined}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={month}
              disabled={busy}
              onChange={(event) => setMonth(event.target.value)}
            >
              <option value="" disabled>
                Month
              </option>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Year" error={error && month && !year ? error : undefined}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={year}
              disabled={busy}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="" disabled>
                Year
              </option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Button type="submit" variant="primary" size="lg" block disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
