import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Thin wrappers over native table elements carrying the civic table styling.
 * Native elements rather than a data-grid abstraction: every config tab has a
 * different cell shape (inline inputs, checkbox matrices, action buttons), so
 * a column-config API would fight the callers more than it helped them.
 */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-civic-100">{children}</thead>;
}

export function TH({
  className,
  align = "left",
  children,
}: {
  className?: string;
  align?: "left" | "center" | "right";
  children?: ReactNode;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-civic-400",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-civic-50">{children}</tbody>;
}

export function TR({
  className,
  onClick,
  children,
}: {
  className?: string;
  /** Row-level click (e.g. open the record). Cells that own their own
   *  interaction should stop propagation. */
  onClick?: MouseEventHandler<HTMLTableRowElement>;
  children: ReactNode;
}) {
  return (
    <tr onClick={onClick} className={cn("transition-colors hover:bg-civic-50/50", className)}>
      {children}
    </tr>
  );
}

export function TD({
  className,
  align = "left",
  colSpan,
  onClick,
  children,
}: {
  className?: string;
  align?: "left" | "center" | "right";
  colSpan?: number;
  onClick?: MouseEventHandler<HTMLTableCellElement>;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      onClick={onClick}
      className={cn(
        "px-3 py-2 align-middle",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Centred placeholder spanning the full table width. */
export function TEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-civic-400">
        {children}
      </td>
    </tr>
  );
}
