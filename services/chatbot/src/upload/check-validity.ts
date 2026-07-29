/**
 * Document validity (expiry / recency) decision — the pure, testable core.
 *
 * Given a catalog item's structured `validity` rule and the dates the vision
 * screen observed on the document, decide whether the document is expired or
 * too old to serve its purpose. This is Phase 2 of the upload-expiry feature:
 * the model OBSERVES dates (Phase 1); this function DECIDES.
 *
 * Modeled directly on services/chatbot/src/authid/decision.ts — the only other
 * date-based rejection in the codebase:
 *   - Pure. No I/O. Never throws.
 *   - Dates parse as `${value}T23:59:59Z` — end-of-day UTC, giving the resident
 *     the benefit of the WHOLE anchor day (so a document dated exactly on the
 *     boundary, or expiring today, is NOT rejected).
 *   - Number.isFinite guards an unparseable date.
 *   - FAIL-OPEN: no rule, illegible dates, a missing anchor date, or an
 *     unparseable value all return { status: 'ok' }. Only a confident,
 *     rule-backed, in-the-past date returns 'expired'. A wrongly-rejected real
 *     resident is far worse than one stale document reaching a clerk.
 *
 * This is INDEPENDENT of the plausibility confidence gate (mapVerdictToAction /
 * the 0.85 threshold): expiry is a factual date comparison, not a vision score.
 */

import type { ContentCheck, DocumentValidity, ObservedDates } from "@st-lucie/shared-types";

/** Machine-readable outcome; `reason` is a stable slug for logging/branching. */
export type ValidityStatus = "ok" | "expired";
export interface ValidityOutcome {
  status: ValidityStatus;
  /** Stable slug when expired: 'document-too-old' | 'document-expired'. */
  reason?: string;
}

const MS_PER_DAY = 86_400_000;

/** Strict full-date shape. Partial dates ('2026', '2026-07') must NOT parse —
 *  they are ambiguous and, per the fail-open invariant, must not drive a reject. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an observed date as end-of-day UTC. Returns NaN (→ fail-open) unless the
 * string is a strict, real YYYY-MM-DD calendar date. `new Date()` alone is too
 * lenient: it accepts partial ISO ('2026' → Jan 1) and silently rolls over
 * impossible dates ('2025-02-29' → Mar 1), either of which would turn an
 * ambiguous/garbled reading into a confident (wrong) expiry reject. We require
 * the exact shape AND round-trip the Y/M/D components to reject rollovers.
 */
function parseAnchorDate(raw: string): number {
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return NaN;
  const [, y, mo, d] = m;
  const t = new Date(`${raw}T23:59:59Z`).getTime();
  if (!Number.isFinite(t)) return NaN;
  const parsed = new Date(t);
  // Reject calendar rollovers (e.g. 2025-02-29 → 2025-03-01): the parsed UTC
  // components must match what was written.
  if (
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() + 1 !== Number(mo) ||
    parsed.getUTCDate() !== Number(d)
  ) {
    return NaN;
  }
  return t;
}

/**
 * Decide whether an uploaded document violates its validity rule. Fail-open on
 * every uncertain case (see file header). `asOf` is the server clock, injected
 * so the decision is deterministic + testable.
 */
export function checkValidity(
  validity: DocumentValidity | undefined,
  observed: ObservedDates | undefined,
  datesLegible: boolean | undefined,
  asOf: Date,
  observedDocument?: string,
): ValidityOutcome {
  if (!validity) return { status: "ok" }; // no rule → not screened
  if (!validity.rule) return { status: "ok" }; // content-checks-only item → no date screening
  // Defensive: 'unexpired' only makes sense against a printed expiry date. A
  // mis-authored rule that anchors 'unexpired' on issued/signed/dated would
  // compare a past effective date and reject ~every valid document — so fail
  // open here rather than mass-reject. (Lint also blocks this at authoring.)
  if (validity.rule === "unexpired" && validity.anchor !== "expires") return { status: "ok" };

  // Subtype scoping (mixed-bucket items): only screen when the model's observed
  // document description matches one of the rule's subtypes. If it doesn't match
  // — or we couldn't classify the doc at all — fail open, so a permanent proof
  // (e.g. a years-old deed uploaded to an address-proof slot) is never rejected.
  if (validity.appliesWhen && validity.appliesWhen.length > 0) {
    const desc = (observedDocument ?? "").toLowerCase();
    const matches = desc !== "" && validity.appliesWhen.some((k) => desc.includes(k.toLowerCase()));
    if (!matches) return { status: "ok" };
  }

  if (datesLegible === false) return { status: "ok" }; // model says dates unreadable
  if (!validity.anchor) return { status: "ok" }; // malformed rule (lint blocks); fail open

  const raw = observed?.[validity.anchor];
  if (!raw) return { status: "ok" }; // the anchor date wasn't observed

  const t = parseAnchorDate(raw);
  if (!Number.isFinite(t)) return { status: "ok" }; // unparseable → don't guess

  const now = asOf.getTime();

  if (validity.rule === "unexpired") {
    return t < now ? { status: "expired", reason: "document-expired" } : { status: "ok" };
  }

  // rule === 'max-age': the anchor date must be within `days` of today.
  // Missing `days` should never reach here (lint blocks it), but fail open.
  if (typeof validity.days !== "number") return { status: "ok" };
  const ageDays = (now - t) / MS_PER_DAY;
  return ageDays > validity.days
    ? { status: "expired", reason: "document-too-old" }
    : { status: "ok" };
}

/**
 * Deterministic, customer-facing rejection sentence for an expired/too-old
 * document. Built server-side (NOT by the model) so the wording is stable and
 * reviewable. Kept generic — it does not need the document's label.
 */
export function buildExpiryReason(validity: DocumentValidity): string {
  if (validity.rule === "max-age") {
    const days = typeof validity.days === "number" ? validity.days : 0;
    return (
      `This document looks older than ${days} days. Please upload one from the ` +
      `last ${days} days, or bring it to your appointment.`
    );
  }
  return (
    "This document appears to have expired. Please upload a current one, or " +
    "bring it to your appointment."
  );
}

/**
 * Turn the vision model's content-check concerns into a single friendly,
 * NON-BLOCKING advisory string — or undefined when there is nothing to say.
 *
 * ADVISORY, never a reject: content/status attributes (Sunbiz "Active", VA
 * "100% permanent", DD-214 "Honorable") are a model judgment, fuzzier than a
 * date compare, so a concern only WARNS the resident — it must never block a
 * valid upload. Returns undefined unless the item actually declares
 * `contentChecks` AND the model flagged at least one real (non-blank) concern,
 * so a normal upload stays clean (no manufactured warnings).
 *
 * @param checks   the item's declared content checks (undefined/[] → no advisory)
 * @param concerns free-text concerns the model reported (attributes clearly
 *                 missing/wrong); blanks are ignored
 */
export function buildContentAdvisory(
  checks: ContentCheck[] | undefined,
  concerns: string[] | undefined,
): string | undefined {
  if (!checks || checks.length === 0) return undefined;
  const real = (concerns ?? []).filter((c) => typeof c === "string" && c.trim() !== "");
  if (real.length === 0) return undefined;
  const list = real.map((c) => c.trim()).join("; ");
  return (
    `Heads up: ${list}. You can still submit this, but it may not be accepted at ` +
    `your appointment — you may want to re-upload a corrected copy or bring the original.`
  );
}
