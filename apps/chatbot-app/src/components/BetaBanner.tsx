import { useState, useEffect } from 'react';

const STORAGE_KEY = 'stlucie-beta-banner-dismissed';

export function BetaBanner() {
  const [dismissed, setDismissed] = useState(true); // start true to avoid flash on SSR
  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);
  if (dismissed) return null;
  return (
    <div className="beta-banner" role="alert">
      <div className="beta-banner-text">
        <strong>Beta — for testing only.</strong> Conversations are recorded for development purposes. Please do NOT enter real Social Security numbers, full driver license numbers, or financial account information.
      </div>
      <button
        className="beta-banner-dismiss"
        aria-label="Dismiss banner"
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, 'true');
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
