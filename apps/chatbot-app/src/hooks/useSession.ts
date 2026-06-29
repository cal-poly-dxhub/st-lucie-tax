/**
 * Session management hook.
 * Supports walk-in kiosk mode via URL params.
 * Supports bookmarkable sessions via ?s=<sessionId> query param.
 */

import { useState, useCallback, useEffect } from "react";
import type { ChatResponse, SessionContext, KBSource } from "../api";
import { rehydrateSession } from "../api";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  messageId: string;
  kbSources?: KBSource[];
}

export interface MessageFeedbackEntry {
  reaction?: "good" | "bad";
  comment?: string;
  submittedAt: string;
}

export interface SessionData {
  sessionId: string | null;
  state: string;
  messages: Message[];
  context: SessionContext | null;
  transactions: ChatResponse["identifiedTransactions"];
  combinedDocuments: string[];
  totalDuration: number;
  isWalkIn: boolean;
  walkInLocationId: string | null;
  messageFeedback: Record<string, MessageFeedbackEntry>;
  generalFeedbackNotes: string;
}

function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Preserve any non-`s` query params (e.g. ?mode=walkin&location=) when we
// mutate the URL.
function buildUrlWithSid(sid: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (sid) {
    params.set("s", sid);
  } else {
    params.delete("s");
  }
  const qs = params.toString();
  return window.location.pathname + (qs ? `?${qs}` : "");
}

function readSidFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("s");
  // Basic sanity — UUIDs are 36 chars with dashes. Reject obvious garbage so
  // we don't waste a rehydrate round-trip on `?s=<random-string>`.
  if (!sid) return null;
  if (!/^[0-9a-f-]{20,}$/i.test(sid)) return null;
  return sid;
}

export function useSession() {
  const [session, setSession] = useState<SessionData>(() => {
    // Check for walk-in kiosk mode per spec: ?location=<id>&mode=walkin
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const locationId = params.get("location");

    return {
      sessionId: null,
      state: "landing",
      messages: [],
      context: null,
      transactions: [],
      combinedDocuments: [],
      totalDuration: 0,
      isWalkIn: mode === "walkin",
      walkInLocationId: locationId,
      messageFeedback: {},
      generalFeedbackNotes: "",
    };
  });

  const [isLoading, setIsLoading] = useState(false);
  const [rehydrating, setRehydrating] = useState<boolean>(() => !!readSidFromUrl());

  // Mount: if ?s=<sid> is present, fetch and rehydrate. 404 falls through to
  // the empty landing state + strips the bad param from the URL.
  useEffect(() => {
    const sid = readSidFromUrl();
    if (!sid) return;

    let cancelled = false;
    (async () => {
      try {
        const resp = await rehydrateSession(sid);
        if (cancelled) return;
        if (!resp) {
          // Expired or invalid — clear the URL and let the user start over.
          window.history.replaceState({}, "", buildUrlWithSid(null));
          setRehydrating(false);
          return;
        }

        // Derive transactions/combinedDocuments/totalDuration from
        // structuredContext for consistency with updateFromResponse.
        const txns = (resp.session.structuredContext.transactions || [])
          .filter((t) => t.status === "active")
          .map((t) => ({
            txnTypeId: t.txnTypeId,
            name: t.name,
            durationMinutes: t.durationMinutes,
          }));
        const totalDuration = txns.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);

        // Rehydrated history items don't carry a messageId (it's a
        // client-side-only field), so synthesize stable ones now so feedback
        // buttons on already-displayed messages remain referenceable.
        const rehydratedMessages: Message[] = resp.messages.map((m) => ({
          ...m,
          messageId: newMessageId(),
        }));

        setSession((prev) => ({
          ...prev,
          sessionId: resp.session.sessionId,
          state: resp.session.currentState,
          context: resp.session.structuredContext,
          messages: rehydratedMessages,
          transactions: txns,
          combinedDocuments: [],
          totalDuration,
        }));
      } catch (err) {
        console.error("Rehydrate failed:", err);
        window.history.replaceState({}, "", buildUrlWithSid(null));
      } finally {
        if (!cancelled) setRehydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const addUserMessage = useCallback((content: string) => {
    setSession((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { role: "user", content, timestamp: new Date().toISOString(), messageId: newMessageId() },
      ],
    }));
  }, []);

  const updateFromResponse = useCallback((data: ChatResponse) => {
    setSession((prev) => {
      // First-known sessionId — push it to the URL so the tab becomes
      // bookmarkable without a reload.
      if (!prev.sessionId && data.sessionId) {
        window.history.replaceState({}, "", buildUrlWithSid(data.sessionId));
      }
      return {
        ...prev,
        sessionId: data.sessionId,
        state: data.state,
        messages: [
          ...prev.messages,
          {
            role: "assistant",
            content: data.message,
            timestamp: new Date().toISOString(),
            // Prefer the server-assigned id so per-message feedback persists under
            // the same id stored on the HISTORY row (admin renders it inline).
            // Falls back to a local id for older backends / unexpected omissions.
            messageId: data.messageId ?? newMessageId(),
            kbSources: data.kbSources,
          },
        ],
        context: data.structuredContext || prev.context,
        transactions:
          data.identifiedTransactions.length > 0 ? data.identifiedTransactions : prev.transactions,
        combinedDocuments:
          data.combinedDocuments.length > 0 ? data.combinedDocuments : prev.combinedDocuments,
        totalDuration: data.totalDurationMinutes || prev.totalDuration,
      };
    });
  }, []);

  const recordMessageFeedback = useCallback(
    (messageId: string, patch: { reaction?: "good" | "bad"; comment?: string }) => {
      setSession((prev) => {
        const existing = prev.messageFeedback[messageId];
        const next: MessageFeedbackEntry = {
          reaction: patch.reaction ?? existing?.reaction,
          comment: patch.comment ?? existing?.comment,
          submittedAt: new Date().toISOString(),
        };
        return {
          ...prev,
          messageFeedback: { ...prev.messageFeedback, [messageId]: next },
        };
      });
    },
    [],
  );

  const setGeneralFeedbackNotes = useCallback((value: string) => {
    setSession((prev) => ({ ...prev, generalFeedbackNotes: value }));
  }, []);

  const updateState = useCallback((newState: string, context?: SessionContext) => {
    setSession((prev) => ({
      ...prev,
      state: newState,
      context: context || prev.context,
    }));
  }, []);

  const reset = useCallback(() => {
    // Strip ?s= from the URL so the tab no longer points at the old session.
    window.history.replaceState({}, "", buildUrlWithSid(null));
    setSession((prev) => ({
      sessionId: null,
      state: "landing",
      messages: [],
      context: null,
      transactions: [],
      combinedDocuments: [],
      totalDuration: 0,
      isWalkIn: prev.isWalkIn,
      walkInLocationId: prev.walkInLocationId,
      messageFeedback: {},
      generalFeedbackNotes: "",
    }));
  }, []);

  return {
    session,
    isLoading,
    setIsLoading,
    addUserMessage,
    updateFromResponse,
    updateState,
    reset,
    rehydrating,
    recordMessageFeedback,
    setGeneralFeedbackNotes,
  };
}
