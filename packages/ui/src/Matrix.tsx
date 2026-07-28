import { cn } from "./cn";
import { Check } from "./forms";
import { Table, THead, TBody, TR, TH, TD, TEmpty } from "./Table";

export interface MatrixAxis {
  id: string;
  label: string;
}

/**
 * Row × column grid of toggles — used for clerk skills, transaction/office
 * availability, and per-transaction required documents.
 *
 * `isOn(rowId, colId)` reads state and `onToggle(rowId, colId, next)` writes it;
 * the component holds none itself, so callers can persist per cell and reflect
 * server truth without a second source of state. `isBusy` dims and disables a
 * cell while its write is in flight.
 */
export function Matrix({
  rows,
  cols,
  isOn,
  onToggle,
  isBusy,
  isDisabled,
  rowHeader = "",
  emptyMessage = "Nothing to configure yet.",
  className,
}: {
  rows: MatrixAxis[];
  cols: MatrixAxis[];
  isOn: (rowId: string, colId: string) => boolean;
  onToggle: (rowId: string, colId: string, next: boolean) => void;
  isBusy?: (rowId: string, colId: string) => boolean;
  isDisabled?: (rowId: string, colId: string) => boolean;
  rowHeader?: string;
  emptyMessage?: string;
  className?: string;
}) {
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
    <Table className={className}>
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="sticky left-0 bg-white/90">{rowHeader}</TH>
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
            <TD className="sticky left-0 bg-white/90 font-medium text-civic-800">{r.label}</TD>
            {cols.map((c) => {
              const busy = isBusy?.(r.id, c.id) ?? false;
              const on = isOn(r.id, c.id);
              return (
                <TD key={c.id} align="center">
                  <Check
                    checked={on}
                    disabled={busy || (isDisabled?.(r.id, c.id) ?? false)}
                    onChange={(e) => onToggle(r.id, c.id, e.target.checked)}
                    aria-label={`${r.label} — ${c.label}`}
                    className={cn(busy && "animate-pulse")}
                  />
                </TD>
              );
            })}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
