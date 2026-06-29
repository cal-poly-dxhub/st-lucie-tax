/**
 * Drag-to-resize hook for a panel that sits to the RIGHT of its drag handle
 * (so the handle is on the panel's left edge, and dragging right shrinks it).
 *
 * Width is clamped to [min, max] and persisted per storageKey in localStorage
 * so the layout survives a refresh.
 */
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface ResizableWidth {
  width: number;
  startDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useResizableWidth(
  initialWidth: number,
  storageKey: string,
  { min = 180, max = 900 }: { min?: number; max?: number } = {},
): ResizableWidth {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return initialWidth;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : initialWidth;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // storage disabled — ignore
    }
  }, [width, storageKey]);

  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        setWidth(clamp(startWidth - dx, min, max));
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [width, min, max],
  );

  return { width, startDrag };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
