import { createContext, useContext } from "react";

type ToastKind = "success" | "error";

export const ToastContext = createContext<{
  notify: (kind: ToastKind, message: string) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.notify;
}
