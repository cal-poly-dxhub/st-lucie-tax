import { useCallback, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "./cn";
import { ToastContext } from "./toast-context";

type ToastKind = "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[340px] flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-sweep pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-[0_18px_40px_-18px_rgba(8,37,57,0.5)]",
              t.kind === "success" ? "border-go-300/60" : "border-stop-200",
            )}
          >
            <div
              className={cn(
                "mt-0.5 shrink-0",
                t.kind === "success" ? "text-go-500" : "text-stop-500",
              )}
            >
              {t.kind === "success" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            </div>
            <p className="flex-1 text-sm font-medium leading-snug text-ink">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="text-civic-300 transition-colors hover:text-civic-600"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
