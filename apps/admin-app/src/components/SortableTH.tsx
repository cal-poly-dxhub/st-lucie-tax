import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@st-lucie/ui";
import type { SortDirection } from "@/hooks/useSortableTable";

interface SortableTHProps {
  column: string;
  currentColumn: string;
  direction: SortDirection;
  onToggle: (column: string) => void;
  className?: string;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
}

/**
 * A clickable table header cell with sort direction indicators.
 * Drop-in replacement for `<TH>` that adds sorting behavior.
 */
export function SortableTH({
  column,
  currentColumn,
  direction,
  onToggle,
  className,
  align = "left",
  children,
}: SortableTHProps) {
  const isActive = column === currentColumn;

  return (
    <th
      scope="col"
      className={cn(
        "cursor-pointer select-none px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-civic-400 transition-colors hover:text-civic-700",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        isActive && "text-civic-700",
        className,
      )}
      onClick={() => onToggle(column)}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isActive ? (
          direction === "asc" ? (
            <ChevronUp size={12} strokeWidth={2.5} />
          ) : (
            <ChevronDown size={12} strokeWidth={2.5} />
          )
        ) : (
          <ChevronsUpDown size={12} strokeWidth={2} className="opacity-40" />
        )}
      </span>
    </th>
  );
}
