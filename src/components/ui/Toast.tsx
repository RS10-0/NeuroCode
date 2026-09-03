import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

import { ToastContext } from "./toastContext";
import type { ToastTone } from "./toastContext";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ICONS = {
  info: Info,
  correct: CircleCheck,
  error: CircleAlert,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current;
      nextId.current += 1;

      setToasts((current) => [...current, { id, tone, message }]);

      /* Errors stay longer — they usually need reading twice. */
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];

          return (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              <Icon className="toast__icon" size={16} aria-hidden="true" />
              <span className="toast__body">{toast.message}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
