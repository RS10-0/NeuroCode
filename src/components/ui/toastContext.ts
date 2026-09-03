import { createContext } from "react";

export type ToastTone = "info" | "correct" | "error";

export interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

/*
 * Kept out of Toast.tsx so that file only exports components —
 * mixing hooks and components in one module breaks fast refresh.
 */
export const ToastContext = createContext<ToastContextValue | undefined>(
  undefined
);
