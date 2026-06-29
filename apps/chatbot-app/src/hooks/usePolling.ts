/**
 * Polling hook for session state updates.
 * Used for async updates: OCR results, queue placement confirmation.
 */

import { useEffect, useRef } from "react";
import { getSessionState } from "../api";
import type { SessionContext } from "../api";

const POLL_INTERVAL = 5000;

export function usePolling(
  sessionId: string | null,
  enabled: boolean,
  onUpdate: (state: string, context: SessionContext) => void,
) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const interval = setInterval(async () => {
      try {
        const data = await getSessionState(sessionId);
        callbackRef.current(data.state, data.structuredContext);
      } catch {
        // Silently ignore polling errors
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [sessionId, enabled]);
}
