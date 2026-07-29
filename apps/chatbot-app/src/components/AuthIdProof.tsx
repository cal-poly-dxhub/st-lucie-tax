import { useEffect, useRef, useState } from "react";
import { submitAuthIdResult } from "../api";

interface Props {
  sessionId: string;
  embedUrl: string;
  mode: "proof" | "verified";
  onComplete: (
    outcome: "pass" | "review" | "rejected" | "authid-failed",
    reasons: string[],
    greeting?: string,
  ) => void;
  /** Fired when the customer closes/declines the AuthID flow without finishing.
   *  The parent should tear down the widget and proceed as a skip. */
  onCancel: () => void;
}

type Phase = "mounted" | "awaiting-result" | "done";

// The AuthID-hosted iframe posts a `pageName` for each screen. The only
// success terminal is `verifiedPage`. When the user clicks Close/Cancel the
// iframe shows a terminal decline page (names vary: verifyDeclinedPage,
// cancelPage, etc.) — match those by keyword so we can dismiss the overlay
// instead of stranding the user behind it.
const CANCEL_PAGE = /declin|cancel|close|abort|exit/i;

// Non-blocking re-poll: each backend request polls AuthID only briefly and may
// return {status:'pending'}. We re-poll client-side on a short interval up to
// an overall cap, so a still-processing verification completes without any one
// request blocking past the API-Gateway timeout. On cap-exceeded we surface
// the same error+skip escape as a transport failure — the resident is never
// trapped on the "Verifying…" screen.
const REPOLL_INTERVAL_MS = 3500;
const REPOLL_MAX_TOTAL_MS = 60_000;

export function AuthIdProof({ sessionId, embedUrl, mode, onComplete, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("mounted");
  const [error, setError] = useState<string | null>(null);
  // Guards the async re-poll loop against firing after unmount / a second start.
  const pollingRef = useRef(false);

  // Prevent the page behind the overlay from scrolling (mobile: the camera UI
  // should own all touch gestures, not compete with the chat scroll).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const authIdOrigin = (() => {
      try {
        return new URL(embedUrl).origin;
      } catch {
        return null;
      }
    })();

    // Cancelled when the effect tears down (unmount / dep change) so a
    // scheduled re-poll doesn't call setState or onComplete on a dead widget.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Poll the backend for the result, re-polling on `pending` until a terminal
    // status arrives or the overall cap elapses.
    function pollForResult(deadline: number): void {
      submitAuthIdResult(sessionId)
        .then((r) => {
          if (cancelled) return;
          if (r.status === "pending") {
            if (Date.now() + REPOLL_INTERVAL_MS >= deadline) {
              // Out of budget — treat like a transport failure: show the error
              // box with the "Continue without verifying" (skip) escape.
              setError("This is taking longer than expected");
              return;
            }
            timer = setTimeout(() => {
              if (!cancelled) pollForResult(deadline);
            }, REPOLL_INTERVAL_MS);
            return;
          }
          setPhase("done");
          onComplete(r.status, r.reasons ?? [], r.greeting);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }

    function onMessage(event: MessageEvent<{ success?: boolean; pageName?: string }>) {
      // Only react to messages from the AuthID iframe itself.
      if (authIdOrigin && event.origin !== authIdOrigin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const pageName = data.pageName;

      // Success terminal → fetch the result and advance (re-polling on pending).
      if (pageName === "verifiedPage" && data.success) {
        if (pollingRef.current) return; // ignore duplicate verifiedPage posts
        pollingRef.current = true;
        setPhase("awaiting-result");
        pollForResult(Date.now() + REPOLL_MAX_TOTAL_MS);
        return;
      }

      // Decline/cancel/close terminal → tear down + proceed as a skip.
      if (typeof pageName === "string" && CANCEL_PAGE.test(pageName)) {
        onCancel();
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [sessionId, embedUrl, onComplete, onCancel]);

  return (
    <div className="authid-proof" data-mode={mode} data-phase={phase}>
      {phase === "mounted" && <authid-component data-url={embedUrl} />}
      {phase === "awaiting-result" && !error && (
        <div className="authid-proof-waiting">Verifying — one moment…</div>
      )}
      {error && (
        <div className="authid-proof-error" role="alert">
          We couldn&apos;t finish verification: {error}.{" "}
          <button type="button" className="authid-proof-dismiss" onClick={onCancel}>
            Continue without verifying
          </button>
        </div>
      )}
    </div>
  );
}
