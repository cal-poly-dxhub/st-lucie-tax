import { useEffect, useState } from 'react';
import { submitAuthIdResult } from '../api';

interface Props {
  sessionId: string;
  embedUrl: string;
  mode: 'proof' | 'verified';
  onComplete: (outcome: 'pass' | 'review' | 'rejected' | 'authid-failed', reasons: string[], greeting?: string) => void;
  /** Fired when the customer closes/declines the AuthID flow without finishing.
   *  The parent should tear down the widget and proceed as a skip. */
  onCancel: () => void;
}

type Phase = 'mounted' | 'awaiting-result' | 'done';

// The AuthID-hosted iframe posts a `pageName` for each screen. The only
// success terminal is `verifiedPage`. When the user clicks Close/Cancel the
// iframe shows a terminal decline page (names vary: verifyDeclinedPage,
// cancelPage, etc.) — match those by keyword so we can dismiss the overlay
// instead of stranding the user behind it.
const CANCEL_PAGE = /declin|cancel|close|abort|exit/i;

export function AuthIdProof({ sessionId, embedUrl, mode, onComplete, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('mounted');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authIdOrigin = (() => {
      try { return new URL(embedUrl).origin; } catch { return null; }
    })();

    function onMessage(event: MessageEvent<{ success?: boolean; pageName?: string }>) {
      // Only react to messages from the AuthID iframe itself.
      if (authIdOrigin && event.origin !== authIdOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const pageName = data.pageName;

      // Success terminal → fetch the result and advance.
      if (pageName === 'verifiedPage' && data.success) {
        setPhase('awaiting-result');
        submitAuthIdResult(sessionId)
          .then((r) => {
            setPhase('done');
            onComplete(r.status, r.reasons ?? [], r.greeting);
          })
          .catch((e: Error) => setError(e.message));
        return;
      }

      // Decline/cancel/close terminal → tear down + proceed as a skip.
      if (typeof pageName === 'string' && CANCEL_PAGE.test(pageName)) {
        onCancel();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId, embedUrl, onComplete, onCancel]);

  return (
    <div className="authid-proof" data-mode={mode} data-phase={phase}>
      {phase === 'mounted' && (
        <authid-component data-url={embedUrl} />
      )}
      {phase === 'awaiting-result' && (
        <div className="authid-proof-waiting">
          Verifying — one moment…
        </div>
      )}
      {error && (
        <div className="authid-proof-error" role="alert">
          We couldn&apos;t finish verification: {error}.{' '}
          <button type="button" className="authid-proof-dismiss" onClick={onCancel}>
            Continue without verifying
          </button>
        </div>
      )}
    </div>
  );
}
