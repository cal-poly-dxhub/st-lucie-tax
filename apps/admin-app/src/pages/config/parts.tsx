import { type ReactNode } from "react";
import { Button, Card, SectionLabel } from "@st-lucie/ui";

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-stop-200 bg-stop-50 px-4 py-3 text-sm font-medium text-stop-700"
    >
      {children}
    </div>
  );
}

/** Titled card used as the container for each block on a config tab. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>{title}</SectionLabel>
          {description && <p className="mt-1 max-w-2xl text-sm text-civic-500">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-civic-400">{label}</p>;
}

/**
 * Destructive action with an inline confirm step — the config tabs delete rows
 * that other tables reference, so a misclick is expensive.
 */
export function DeleteButton({
  confirming,
  onArm,
  onCancel,
  onConfirm,
  disabled,
  label = "Delete",
}: {
  confirming: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  label?: string;
}) {
  if (!confirming) {
    return (
      <Button variant="ghost" disabled={disabled} onClick={onArm} className="px-2 py-1">
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="danger" disabled={disabled} onClick={onConfirm} className="px-2 py-1">
        Confirm
      </Button>
      <Button variant="ghost" disabled={disabled} onClick={onCancel} className="px-2 py-1">
        Cancel
      </Button>
    </span>
  );
}
