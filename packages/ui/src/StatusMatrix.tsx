import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { Table, THead, TBody, TR, TH, TD, TEmpty } from "./Table";

export interface StatusMatrixAxis {
  id: string;
  label: string;
}

export type CellStatus = "active" | "hidden" | "internal";

export interface CellState {
  status: CellStatus;
  from: string | null;
  until: string | null;
  inherited: boolean;
}

export interface TimeBounds {
  open: string;
  close: string;
}

/**
 * A transaction × office grid where each cell shows a clickable status badge.
 *
 * Clicking opens an inline popover to edit status and time window.
 * `getCell(rowId, colId)` reads the effective state; `onSave` and `onClear`
 * write changes back. The component holds only popover-open state.
 */
export function StatusMatrix({
  rows,
  cols,
  getCell,
  getTimeBounds,
  onSave,
  onClear,
  isBusy,
  rowHeader = "",
  emptyMessage = "Nothing to configure yet.",
  className,
}: {
  rows: StatusMatrixAxis[];
  cols: StatusMatrixAxis[];
  getCell: (rowId: string, colId: string) => CellState;
  getTimeBounds?: (colId: string) => TimeBounds | null;
  onSave: (rowId: string, colId: string, status: CellStatus, from: string | null, until: string | null) => void;
  onClear: (rowId: string, colId: string) => void;
  isBusy?: (rowId: string, colId: string) => boolean;
  rowHeader?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const [openCell, setOpenCell] = useState<string | null>(null);

  const close = useCallback(() => setOpenCell(null), []);

  if (!rows.length || !cols.length) {
    return (
      <Table className={className}>
        <TBody>
          <TEmpty colSpan={1}>{emptyMessage}</TEmpty>
        </TBody>
      </Table>
    );
  }

  return (
    <>
      {/* Overlay to catch outside clicks */}
      {openCell && (
        <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
      )}
      <div className={cn("overflow-x-auto", className)}>
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="sticky left-0 z-10 bg-white/90">{rowHeader}</TH>
              {cols.map((c) => (
                <TH key={c.id} align="center">
                  {c.label}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="sticky left-0 z-10 bg-white/90 font-medium text-civic-800">
                  {r.label}
                </TD>
                {cols.map((c) => {
                  const cellKey = `${r.id}|${c.id}`;
                  const cell = getCell(r.id, c.id);
                  const busy = isBusy?.(r.id, c.id) ?? false;
                  const isOpen = openCell === cellKey;

                  return (
                    <TD key={c.id} align="center" className="relative">
                      <StatusBadge
                        cell={cell}
                        busy={busy}
                        onClick={() => setOpenCell(isOpen ? null : cellKey)}
                      />
                      {isOpen && (
                        <CellPopover
                          rowLabel={r.label}
                          colLabel={c.label}
                          cell={cell}
                          bounds={getTimeBounds?.(c.id) ?? null}
                          onSave={(status, from, until) => {
                            onSave(r.id, c.id, status, from, until);
                            close();
                          }}
                          onClear={() => {
                            onClear(r.id, c.id);
                            close();
                          }}
                          onCancel={close}
                        />
                      )}
                    </TD>
                  );
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <Legend />
    </>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

const badgeStyles: Record<CellStatus, string> = {
  active: "bg-go-50 text-go-700 ring-go-300/50",
  hidden: "bg-civic-950/5 text-civic-500 ring-civic-950/10",
  internal: "bg-warn-50 text-warn-700 ring-warn-200",
};

function StatusBadge({
  cell,
  busy,
  onClick,
}: {
  cell: CellState;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex flex-col items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-transform hover:scale-105 hover:shadow-md",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-civic-400",
        "disabled:opacity-50 disabled:cursor-wait",
        badgeStyles[cell.status],
        cell.inherited && "ring-dashed",
        busy && "animate-pulse",
      )}
      aria-label={`${cell.status}${cell.inherited ? " (inherited)" : ""}`}
    >
      <span>{cell.status}</span>
      {(cell.from || cell.until) && (
        <span className="text-[9px] font-normal opacity-75">
          {cell.from ?? "—"} – {cell.until ?? "—"}
        </span>
      )}
    </button>
  );
}

// ─── Popover editor ──────────────────────────────────────────────────────────

function CellPopover({
  rowLabel,
  colLabel,
  cell,
  bounds,
  onSave,
  onClear,
  onCancel,
}: {
  rowLabel: string;
  colLabel: string;
  cell: CellState;
  bounds: TimeBounds | null;
  onSave: (status: CellStatus, from: string | null, until: string | null) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<CellStatus>(cell.status);
  const [from, setFrom] = useState(cell.from ?? "");
  const [until, setUntil] = useState(cell.until ?? "");
  const popRef = useRef<HTMLDivElement>(null);

  // Normalize time strings to HH:MM for consistent comparison
  const norm = (t: string) => t.slice(0, 5);

  // Validate time window
  const fromBeforeUntil = !from || !until || from < until;
  const withinBounds =
    !bounds ||
    (!from && !until) ||
    ((from ? norm(from) >= norm(bounds.open) : true) &&
      (until ? norm(until) <= norm(bounds.close) : true));
  const timeValid = fromBeforeUntil && withinBounds;

  // Focus the select on open
  useEffect(() => {
    const sel = popRef.current?.querySelector("select");
    sel?.focus();
  }, []);

  return (
    <div
      ref={popRef}
      className="absolute top-full left-1/2 z-50 mt-1.5 w-60 -translate-x-1/2 rounded-xl border border-civic-100 bg-white p-4 text-left shadow-[0_8px_32px_rgba(0,0,0,0.14)]"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Edit ${rowLabel} at ${colLabel}`}
    >
      {/* Arrow */}
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-white" />

      <h3 className="mb-3 text-xs font-bold text-civic-800">
        {rowLabel}
        <span className="font-normal text-civic-500"> @ {colLabel}</span>
      </h3>

      <div className="mb-3">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-civic-400">
          Status
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CellStatus)}
          className="w-full rounded-md border border-civic-200 bg-civic-50/50 px-2.5 py-1.5 text-sm text-civic-800 focus:border-civic-400 focus:outline-none focus:ring-2 focus:ring-civic-200"
        >
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
          <option value="internal">Internal</option>
        </select>
      </div>

      {status === "active" && (
        <div className="mb-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-civic-400">
            Time window{bounds && <span className="font-normal"> ({norm(bounds.open)}–{norm(bounds.close)})</span>}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={from}
              min={bounds ? norm(bounds.open) : undefined}
              max={bounds ? norm(bounds.close) : undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-civic-200 bg-civic-50/50 px-2 py-1.5 text-sm text-civic-800 focus:border-civic-400 focus:outline-none focus:ring-2 focus:ring-civic-200"
              aria-label="Available from"
            />
            <input
              type="time"
              value={until}
              min={bounds ? norm(bounds.open) : undefined}
              max={bounds ? norm(bounds.close) : undefined}
              onChange={(e) => setUntil(e.target.value)}
              className="rounded-md border border-civic-200 bg-civic-50/50 px-2 py-1.5 text-sm text-civic-800 focus:border-civic-400 focus:outline-none focus:ring-2 focus:ring-civic-200"
              aria-label="Available until"
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-civic-100 pt-3">
        {status === "active" && !timeValid && (
          <p className="text-[10px] text-stop-600">
            {!fromBeforeUntil
              ? '"From" must be before "Until"'
              : `Times must be within office hours (${bounds ? norm(bounds.open) : ""}–${bounds ? norm(bounds.close) : ""})`}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={status === "active" && !timeValid}
            onClick={() =>
              onSave(
                status,
                status === "active" ? from || null : null,
                status === "active" ? until || null : null,
              )
            }
            className="rounded-lg bg-go-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-go-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
          {!cell.inherited && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg bg-civic-950/5 px-3 py-1.5 text-xs font-semibold text-civic-600 transition hover:bg-civic-100"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto px-3 py-1.5 text-xs font-semibold text-civic-400 transition hover:text-civic-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-civic-500">
      <LegendItem className="bg-go-50 ring-go-300/50 ring-dashed">Inherited</LegendItem>
      <LegendItem className="bg-go-50 ring-go-300/50">Active (override)</LegendItem>
      <LegendItem className="bg-warn-50 ring-warn-200">Internal</LegendItem>
      <LegendItem className="bg-civic-950/5 ring-civic-950/10">Hidden</LegendItem>
    </div>
  );
}

function LegendItem({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2.5 rounded-full ring-1 ring-inset", className)} />
      {children}
    </span>
  );
}
