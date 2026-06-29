/**
 * Shared classifier for which transactions are sensitive to a driver-license
 * suspension. Used by:
 *  - The dynamic universal-blockers tool builder (omits the licenseSuspended
 *    input entirely when no active txn is DL-family).
 *  - The universal-blockers state prompt (strips Q1 from the LLM's instructions
 *    when not needed).
 *  - The blocker tool handler (no-op for non-DL txns).
 *
 * Keep this list narrow and explicit — anything not on it is not blocked by
 * a DL suspension.
 */

import type { Session } from "@st-lucie/shared-types";

export function isDlFamilyTransaction(txnTypeId: string): boolean {
  return (
    txnTypeId.startsWith("dl-") ||
    txnTypeId === "cdl" ||
    // NOTE: 'learner-permit' intentionally NOT here. The suspension eligibility
    // question is meaningless for a first-time driver who never held a license
    // (FLHSMV: the only learner-permit block is education non-compliance, not a
    // suspension — CI03.4.1 / CI06C.45). Including it produced the nonsensical
    // "is your driver license suspended?" question in beta session 96b6e325.
    txnTypeId === "road-test" ||
    txnTypeId === "written-test" ||
    txnTypeId === "real-id-upgrade"
  );
}

export function sessionHasDlFamilyTxn(session: Session): boolean {
  return session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .some((t) => isDlFamilyTransaction(t.txnTypeId));
}

/**
 * Transactions where the applicant provably has NO Florida driver license to
 * scan, so the AuthID Proof step (which captures a DL + selfie) makes no sense:
 *  - learner-permit / written-test: first-time drivers, pre-license.
 *  - road-test: applicant holds a learner permit, not a DL.
 *  - id-card: non-drivers getting a state ID.
 * Per FLHSMV policy (EO02.4.1, CI03.4.1, IR09.3) these prove identity with a
 * birth certificate / passport / SSN, never an existing DL.
 */
export function isNoLicenseToScanTransaction(txnTypeId: string): boolean {
  return (
    txnTypeId === "learner-permit" ||
    txnTypeId === "written-test" ||
    txnTypeId === "road-test" ||
    txnTypeId === "id-card"
  );
}

/**
 * True only when EVERY active transaction is a no-license-to-scan type — i.e.
 * there is nothing for AuthID to scan, so verify-identity should be skipped.
 * If the session mixes a no-DL txn with a DL txn (e.g. id-card + dl-renewal),
 * this returns false so the DL transaction still gets identity verification.
 */
export function sessionHasNoLicenseToScan(session: Session): boolean {
  const active = session.structuredContext.transactions.filter((t) => t.status === "active");
  if (active.length === 0) return false;
  return active.every((t) => isNoLicenseToScanTransaction(t.txnTypeId));
}
