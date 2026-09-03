import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import Button from "./Button";

interface DialogProps {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /* Renders the confirm action in the danger variant. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function Dialog({
  open,
  title,
  text,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    /*
     * FOCUS LANDS ON CANCEL, NOT ON CONFIRM.
     *
     * Focus has to go somewhere inside the dialog — leaving it
     * on the control that opened this means Escape is the only
     * keyboard way out and a screen reader starts reading the
     * page behind. The question is only which control.
     *
     * It used to be the confirm button, which made every
     * dialog in the product answerable by pressing Enter
     * twice: once on the control that opened it, once on the
     * button already focused underneath. For a "discard this
     * draft" that is a convenience. For the send dialog it
     * defeated the thing the second step exists to do — the
     * message could leave without the provenance below it ever
     * being expanded, or read.
     *
     * A confirmation whose default answer is yes is not a
     * confirmation, so the safe control takes focus and the
     * consequential one has to be chosen.
     */
    cancelRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {text ? <p className="dialog__text">{text}</p> : null}

        {children}

        <div className="dialog__actions">
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
