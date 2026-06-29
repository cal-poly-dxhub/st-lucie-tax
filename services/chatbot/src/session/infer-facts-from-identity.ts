/**
 * Derive the two age facts from the verified driver-license DOB:
 *
 *   - `applicant_age_meets_cdl` (17.5+)   — CDL testing age floor
 *   - `purchaser_age_status`     (18+)     — vehicle title minor-co-purchaser gate
 *
 * verify-identity now runs AFTER resolve-facts, so the customer may have
 * already self-reported these during the questions. AuthID's DL is the
 * OFFICIAL source of truth, so we OVERWRITE the self-reported values when the
 * DOB-derived value differs. Any branch this reopens surfaces in the
 * confirm-facts review (the customer reconciles it there).
 *
 * One nuance for `purchaser_age_status`: DOB only distinguishes adult vs minor,
 * not the co-purchaser detail. If the customer said `minor-with-adult-
 * co-purchaser` and the DL confirms they ARE a minor, we keep their richer
 * answer (the DL doesn't contradict it). We only force the value when the DL
 * disagrees on the adult/minor split.
 *
 * Returns the list of fact keys this set or changed (for logging only).
 */
import type { Session, FactValue } from "@st-lucie/shared-types";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function inferFactsFromIdentity(session: Session): string[] {
  const identity = session.structuredContext.identity;
  const dob = identity?.dob;
  if (!dob) return [];

  const ageYears = yearsBetween(dob, new Date());
  if (ageYears === null) return [];

  const now = new Date().toISOString();
  const changed: string[] = [];
  const facts = session.structuredContext.facts;

  // applicant_age_meets_cdl — authoritative yes/no from DOB.
  const cdlValue = ageYears >= 17.5 ? "yes" : "no";
  if (facts.applicant_age_meets_cdl?.value !== cdlValue) {
    facts.applicant_age_meets_cdl = officialFact(cdlValue, now);
    changed.push("applicant_age_meets_cdl");
  }

  // purchaser_age_status — DOB gives adult vs minor. Preserve the customer's
  // co-purchaser detail when the DL agrees they're a minor.
  const isAdult = ageYears >= 18;
  const current = facts.purchaser_age_status?.value;
  const customerSaidMinorWithCoPurchaser = current === "minor-with-adult-co-purchaser";
  const purchaserValue = isAdult
    ? "adult-18-plus"
    : customerSaidMinorWithCoPurchaser
      ? "minor-with-adult-co-purchaser"
      : "minor-no-co-purchaser";
  if (current !== purchaserValue) {
    facts.purchaser_age_status = officialFact(purchaserValue, now);
    changed.push("purchaser_age_status");
  }

  return changed;
}

function officialFact(value: string, now: string): FactValue {
  return { value, confidence: "asserted", source: "ocr", updatedAt: now };
}

function yearsBetween(dobString: string, now: Date): number | null {
  const dob = parseDob(dobString);
  if (!dob) return null;
  return (now.getTime() - dob.getTime()) / MS_PER_YEAR;
}

function parseDob(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // ISO: YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return buildDate(+iso[1], +iso[2], +iso[3]);
  // US: MM/DD/YYYY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return buildDate(+us[3], +us[1], +us[2]);
  // Fallback: let Date attempt it
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function buildDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}
