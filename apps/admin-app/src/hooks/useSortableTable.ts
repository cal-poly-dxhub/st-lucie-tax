import { useCallback, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: string;
  direction: SortDirection;
}

/**
 * Generic hook for client-side table sorting.
 *
 * @param defaultColumn - Initial column to sort by
 * @param defaultDirection - Initial direction (default: "asc")
 */
export function useSortableTable(defaultColumn: string, defaultDirection: SortDirection = "asc") {
  const [sortCol, setSortCol] = useState(defaultColumn);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultDirection);

  const toggle = useCallback(
    (col: string) => {
      if (col === sortCol) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir("asc");
      }
    },
    [sortCol],
  );

  /**
   * Sort an array of rows by the current column/direction.
   * Provide an accessor map: `{ columnName: (row) => sortableValue }`.
   */
  function sorted<T>(
    rows: T[],
    accessors: Record<string, (row: T) => string | number | boolean | null | undefined>,
  ): T[] {
    const accessor = accessors[sortCol];
    if (!accessor) return rows;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      }
      const numA = Number(av);
      const numB = Number(bv);
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
  }

  return { sortCol, sortDir, toggle, sorted } as const;
}
