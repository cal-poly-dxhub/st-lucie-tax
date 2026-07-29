/**
 * Sensitive-input scrubbing (SEC-06, narrow variant).
 *
 * Removes the small set of high-danger numbers a citizen might paste into chat
 * that the system NEVER legitimately needs — SSN, payment-card numbers, and
 * bank account/routing numbers — BEFORE the message is persisted to history,
 * sent to the model, or logged.
 *
 * Design intent — "do not scrub useful numbers":
 *   The constrained-LLM engine relies on many numbers (durations like "8
 *   months", money like "$5,000", ZIP codes, phone numbers, confirmation/
 *   appointment numbers, VINs, HSMV form numbers, and the user's own driver-
 *   license number). Over-broad redaction would corrupt fact extraction. So
 *   every pattern here is deliberately conservative:
 *     - cards must pass the Luhn checksum,
 *     - routing numbers must pass the ABA checksum,
 *     - SSNs require either dashed formatting or a nearby "ssn"/"social" cue,
 *     - bank account numbers require a nearby "account"/"acct" cue.
 *   The driver-license number is intentionally PRESERVED (it is the user's own
 *   ID, lower-risk, and may be referenced by a flow).
 *
 * This is harm-reduction, not a guarantee: a determined edge case can slip
 * through. It mirrors the posture of debug-log.ts:redactPii (SEC-18), with
 * which it shares the SSN pattern as a single source of truth for "sensitive".
 *
 * The function is pure and never throws — on any unexpected input it returns
 * the original message unchanged (mirrors appendLog's never-break-the-request
 * rule).
 */

export type SensitiveKind = "ssn" | "card" | "bank";

export interface ScrubResult {
  /** Message with sensitive numbers replaced by the placeholder. */
  clean: string;
  /** Distinct kinds of sensitive data removed (empty if nothing matched). */
  removed: SensitiveKind[];
}

export const SCRUB_PLACEHOLDER = "[sensitive number removed]";

// --- Patterns ---------------------------------------------------------------

// SSN: dashed form is unambiguous. Shared in spirit with debug-log.ts:SSN_RE.
const SSN_DASHED_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Bare 9-digit SSN ONLY when an "ssn"/"social security" cue is within ~24 chars
// before it. Without the cue, 9 bare digits is ambiguous (ZIP+4, ids) — leave it.
const SSN_CONTEXT_RE =
  /\b(?:ssn|social\s*security(?:\s*(?:number|no|#))?)\b[^0-9]{0,24}(\d{3}[- ]?\d{2}[- ]?\d{4})\b/gi;

// Candidate payment-card: 13–19 digits, optionally grouped by single spaces or
// hyphens. Validated by Luhn before redaction (kills VINs, confirmation ids,
// random long numbers that aren't real cards).
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

// Context-cued card: "card"/"credit card"/"debit card"/"card number" followed by
// a 13–19 digit run — scrub even if it FAILS Luhn, because the user explicitly
// labelled it as a card. Covers non-Luhn-compliant test/legacy cards (e.g.
// 4007 0000 0000 0027) that a real person may still type.
const CARD_CONTEXT_RE =
  /\b(?:credit|debit)?\s*card(?:\s*(?:number|no|#|is))?\b[^0-9]{0,20}((?:\d[ -]?){12,18}\d)\b/gi;

// Bank routing: exactly 9 digits, ABA-checksum-valid, with a "routing"/"aba"
// cue nearby. Account number: 6–17 digits with an "account"/"acct" cue nearby.
const ROUTING_CONTEXT_RE = /\b(?:routing|aba)(?:\s*(?:number|no|#))?\b[^0-9]{0,24}(\d{9})\b/gi;
const ACCOUNT_CONTEXT_RE = /\b(?:account|acct)(?:\s*(?:number|no|#))?\b[^0-9]{0,24}(\d{6,17})\b/gi;

// --- Checksums (the false-positive guards) ----------------------------------

/** Luhn checksum — real payment cards satisfy it; arbitrary digit runs rarely do. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' = 48
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** ABA routing checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10). */
function passesAba(digits: string): boolean {
  if (digits.length !== 9) return false;
  const d = [...digits].map((c) => c.charCodeAt(0) - 48);
  if (d.some((n) => n < 0 || n > 9)) return false;
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const onlyDigits = (s: string): string => s.replace(/[^0-9]/g, "");

// --- Public API -------------------------------------------------------------

export function scrubSensitiveInput(message: string): ScrubResult {
  if (typeof message !== "string" || message.length === 0) {
    return { clean: typeof message === "string" ? message : "", removed: [] };
  }
  try {
    const removed = new Set<SensitiveKind>();
    let out = message;

    // 1) SSN — dashed (unambiguous) + bare-with-context.
    out = out.replace(SSN_DASHED_RE, () => {
      removed.add("ssn");
      return SCRUB_PLACEHOLDER;
    });
    out = out.replace(SSN_CONTEXT_RE, (full, num: string) => {
      removed.add("ssn");
      // Preserve the leading cue word; replace only the number portion.
      return full.replace(num, SCRUB_PLACEHOLDER);
    });

    // 2) Bank routing / account — require a cue + checksum (routing only).
    out = out.replace(ROUTING_CONTEXT_RE, (full, num: string) => {
      if (!passesAba(num)) return full; // not a real routing number — keep it
      removed.add("bank");
      return full.replace(num, SCRUB_PLACEHOLDER);
    });
    out = out.replace(ACCOUNT_CONTEXT_RE, (full, num: string) => {
      removed.add("bank");
      return full.replace(num, SCRUB_PLACEHOLDER);
    });

    // 3a) Context-cued cards: user explicitly said "card" nearby — scrub even
    //     if Luhn fails (covers non-Luhn test/legacy cards like 4007000000000027).
    out = out.replace(CARD_CONTEXT_RE, (full, num: string) => {
      removed.add("card");
      return full.replace(num, SCRUB_PLACEHOLDER);
    });

    // 3b) Payment cards — Luhn-validated (no context cue required). Catches bare
    //     card numbers with no labelling text. Done after 3a so context-cued ones
    //     are already replaced and won't double-match.
    out = out.replace(CARD_CANDIDATE_RE, (match) => {
      const digits = onlyDigits(match);
      if (digits.length < 13 || digits.length > 19) return match;
      if (!passesLuhn(digits)) return match; // not a real card — keep it
      removed.add("card");
      return SCRUB_PLACEHOLDER;
    });

    return { clean: out, removed: [...removed] };
  } catch {
    // Never let scrubbing break the request path.
    return { clean: message, removed: [] };
  }
}

/**
 * Build the one-line system-prompt note injected when something was removed, so
 * the bot can transparently reassure the user (decision: "replace + gently
 * warn"). Returns null when nothing was removed.
 */
export function scrubNoticeForPrompt(removed: SensitiveKind[]): string | null {
  if (removed.length === 0) return null;
  const label: Record<SensitiveKind, string> = {
    ssn: "Social Security number",
    card: "payment-card number",
    bank: "bank account/routing number",
  };
  const kinds = removed.map((k) => label[k]).join(" and ");
  return (
    `NOTE: the user's last message contained a ${kinds}, which was automatically ` +
    `removed before it reached you (shown as "${SCRUB_PLACEHOLDER}"). Briefly and ` +
    `kindly reassure them you never need their SSN, card, or bank numbers here, ` +
    `then continue with the current step normally. Do not ask them to re-send it.`
  );
}
