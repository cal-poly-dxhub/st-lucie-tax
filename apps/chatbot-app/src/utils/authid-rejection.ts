/**
 * Turn an AuthID rejection/failure into resident-facing copy.
 *
 * Pure, React-free (unit-testable via the tsx harness). Mirrors the guidance +
 * SECURITY RULE in the verify-identity prompt
 * (services/chatbot/src/prompts/default-prompts.ts): a fixable problem
 * (expired license, mismatch, poor lighting) gets an actionable hint and
 * `canRetry: true`; a sensitive / anti-fraud reason (tamper, injection, or any
 * fail-closed missing-signal / malformed case) collapses to a generic
 * "visit in person" message and `canRetry: false` — we NEVER tell a potential
 * bad actor which detector caught them, so error copy can't be used to probe
 * and refine an attack.
 *
 * Fail-closed default: any reason we don't explicitly recognize as fixable is
 * treated as sensitive.
 */

export interface RejectionCopy {
  message: string;
  canRetry: boolean;
}

const GENERIC_MESSAGE =
  "We weren't able to complete identity verification. You can continue and verify in person at the office, or try again.";

/** Reasons the resident can act on — safe to explain, and worth a retry. */
const FIXABLE: Record<string, string> = {
  "document-expired":
    "Your driver license appears to be expired. You will need to renew it before we can verify it — you can continue for now and finish in person.",
  "selfie-document-mismatch":
    "The selfie didn't match the photo on your license. Try again with good, even lighting and your face centered.",
  "liveness-failed":
    "We couldn't confirm a live person in the selfie. Look directly at the camera in a well-lit spot and try again.",
};

/**
 * Reasons that are self-inflicted-fixable but should NOT leak detail — treated
 * as fixable-retryable but with generic copy (e.g. a genuinely expired doc is
 * fine to name; a tamper/injection signal is not). Listed explicitly so the
 * default-sensitive branch is the catch-all for everything else.
 */
export function describeAuthIdRejection(reasons: string[] | undefined): RejectionCopy {
  const list = Array.isArray(reasons) ? reasons : [];

  // If EVERY reason is a known-fixable one, give the actionable copy and allow
  // retry. A single sensitive/unknown reason flips the whole thing to generic
  // (fail-closed: no detail leak, no retry) — an attacker can't get a hint by
  // also tripping a fixable signal.
  const allFixable = list.length > 0 && list.every((r) => r in FIXABLE);
  if (allFixable) {
    // Prefer expiry messaging when present (most common + most actionable),
    // else the first fixable reason's copy.
    const chosen = list.includes("document-expired") ? "document-expired" : list[0];
    return { message: FIXABLE[chosen], canRetry: true };
  }

  return { message: GENERIC_MESSAGE, canRetry: false };
}
