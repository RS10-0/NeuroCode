import { useId, useState } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown, CircleAlert } from "lucide-react";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /*
   * Receives the generated id so the control is labelled, and
   * `describedBy` so the hint and the error are read out with
   * it. Spreading `describedBy` onto the control is what turns
   * the hint from decoration into something a screen reader
   * ever says — which matters most in the Lab, where the hints
   * are the teaching material rather than a note about
   * formatting.
   */
  children: (props: {
    id: string;
    invalid: boolean;
    describedBy: string | undefined;
  }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const invalid = Boolean(error);

  /*
   * An error that was already there when the field mounted is
   * not an alert.
   *
   * The Lab's prompt box starts empty, so "Write a prompt to
   * run." is present on the very first render — and with
   * role="alert" a screen-reader user was told off for not
   * having typed anything before they had a chance to. The same
   * message is reachable through aria-describedby the moment
   * they focus the field, which is when it is actually useful.
   *
   * Anything that differs from that first message did happen in
   * response to something the learner did, and is announced.
   * Comparing the message rather than tracking a mount flag also
   * stops the initial message from being re-announced on the
   * next re-render, which a flag would have caused on every
   * keystroke elsewhere in the form.
   */
  const [errorAtMount] = useState(error);
  const announces = Boolean(error) && error !== errorAtMount;

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  /* Both, in reading order, and undefined rather than an empty
     string when there is neither — an aria-describedby pointing
     at nothing is worse than none at all. */
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}

      {children({ id, invalid, describedBy })}

      {error ? (
        <span
          className="field__error"
          id={errorId}
          role={announces ? "alert" : undefined}
        >
          <CircleAlert size={13} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid = false, className = "", ...rest }: InputProps) {
  const classes = ["input", invalid ? "input--invalid" : "", className]
    .filter(Boolean)
    .join(" ");

  return <input className={classes} aria-invalid={invalid || undefined} {...rest} />;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Textarea({
  invalid = false,
  mono = false,
  className = "",
  ...rest
}: TextareaProps) {
  const classes = [
    "textarea",
    invalid ? "textarea--invalid" : "",
    mono ? "textarea--mono" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <textarea className={classes} aria-invalid={invalid || undefined} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

export function Select({ className = "", children, ...rest }: SelectProps) {
  return (
    <span className="select-wrap">
      <select className={`select ${className}`.trim()} {...rest}>
        {children}
      </select>
      <ChevronDown className="select-wrap__chevron" size={15} aria-hidden="true" />
    </span>
  );
}
