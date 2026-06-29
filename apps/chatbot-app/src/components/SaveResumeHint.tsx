/**
 * One-time tooltip-style pill that surfaces the "save & resume" affordance.
 *
 * The session's `?s=<sid>` URL param is already a recovery token (set by
 * useSession on first response, restored on reload). Customers don't know
 * that — this pill explains it once, then dismisses forever via localStorage.
 *
 * Mounted in App.tsx; gated on:
 *   - sessionId is non-null
 *   - not currently rehydrating (otherwise rehydrated users see it spuriously)
 *   - not walk-in kiosk mode (kiosks share localStorage across customers)
 *   - localStorage flag not yet set
 */
import { useState } from 'react';

const STORAGE_KEY = 'stlucie:saveResumeHintSeen';

export function shouldShowSaveResumeHint(args: {
  sessionId: string | null;
  rehydrating: boolean;
  isWalkIn: boolean;
}): boolean {
  if (!args.sessionId) return false;
  if (args.rehydrating) return false;
  if (args.isWalkIn) return false;
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    // Some browsers (private mode, locked-down kiosks) throw on localStorage.
    // Treat as "already seen" so we don't spam.
    return false;
  }
}

interface Props {
  onDismiss: () => void;
}

export function SaveResumeHint({ onDismiss }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail; silent fallback — the URL is already in the
      // address bar, customers can copy it manually.
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // No persistence — pill will reappear next visit. Acceptable degradation.
    }
    onDismiss();
  };

  return (
    <div className="save-resume-hint" role="status" aria-live="polite">
      <span className="save-resume-hint-icon" aria-hidden>🔖</span>
      <span className="save-resume-hint-text">
        This page is your bookmark. Close the tab and come back later — your answers will be here.
      </span>
      <button
        type="button"
        className="save-resume-hint-copy"
        onClick={handleCopy}
        aria-label="Copy this page's URL to clipboard"
      >
        {copied ? '✓ copied' : 'Copy link'}
      </button>
      <button
        type="button"
        className="save-resume-hint-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss save-and-resume hint"
      >
        Got it
      </button>
    </div>
  );
}
