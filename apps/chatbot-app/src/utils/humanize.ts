/**
 * Shared text-humanization helpers.
 *
 * `humanize()` was originally inside SmartQuickReplies; promoted here so
 * ConfirmFacts and SidePanel can use the same single source of truth for
 * acronym replacements.
 *
 * `confidenceLabel()` and `acronymLongForm()` translate machine-y vocabulary
 * into the plain-English the customer should see — see the UX HCD plan,
 * section S4. Keeping the data here means tooltips and badge labels never
 * drift across components.
 */

export type FactConfidence = "asserted" | "inferred" | "unknown";

/**
 * Curated acronym map. Lowercase token (as it appears in enum values like
 * `fl-renewal` or `valid-cdl`) → display form. Anything not in the map keeps
 * its title-cased form from the original humanize() pass.
 */
const ACRONYM_REPLACEMENTS: Record<string, string> = {
  fl: "FL",
  us: "US",
  oos: "Out-of-state",
  na: "N/A",
  clp: "CLP",
  cdl: "CDL",
  ssa: "SSA",
  dl: "DL",
  hvut: "HVUT",
  tsa: "TSA",
  dmv: "DMV",
  mydmv: "MyDMV",
  poa: "POA",
  gvw: "GVW",
  dui: "DUI",
  ocr: "OCR",
};

/**
 * Long-form expansion for acronyms — used by AcronymText for tooltips. Only
 * acronyms users would plausibly not recognize get expansions; everyday
 * abbreviations (FL, US) get a marginal expansion that still helps screen-
 * reader users.
 */
const ACRONYM_LONG_FORMS: Record<string, string> = {
  FL: "Florida",
  US: "United States",
  CDL: "Commercial Driver License",
  CLP: "Commercial Learner Permit",
  DL: "Driver License",
  DMV: "Department of Motor Vehicles",
  MyDMV: "MyDMV Portal (online services)",
  POA: "Power of Attorney",
  GVW: "Gross Vehicle Weight",
  HVUT: "Heavy Vehicle Use Tax",
  TSA: "Transportation Security Administration",
  SSA: "Social Security Administration",
  DUI: "Driving Under the Influence",
  OCR: "Optical Character Recognition (reads text from photos)",
  "REAL ID": "REAL ID — federal identification standard for flying and entering federal buildings",
};

/**
 * Convert a kebab-case enum value into a human-friendly sentence.
 * "fl-renewal" → "FL renewal", "expired-more-than-1-yr" → "Expired more than 1 yr".
 * First token is title-cased; subsequent tokens kept lowercase unless mapped.
 */
export function humanize(value: string): string {
  return value
    .split("-")
    .map((tok, i) => {
      if (ACRONYM_REPLACEMENTS[tok]) return ACRONYM_REPLACEMENTS[tok];
      if (i === 0) return tok.charAt(0).toUpperCase() + tok.slice(1);
      return tok;
    })
    .join(" ");
}

/**
 * Look up the long-form expansion for an acronym (as it appears in display
 * text — e.g. "CDL" not "cdl"). Returns undefined if not in the curated map,
 * which AcronymText interprets as "don't wrap this token".
 */
export function acronymLongForm(token: string): string | undefined {
  return ACRONYM_LONG_FORMS[token];
}

/**
 * Plain-English label for a fact's confidence value. The badge shows `short`,
 * the title attribute shows `long` so users can hover/focus to see the
 * explanation. Replaces literal "asserted"/"inferred"/"unknown" badges.
 */
export function confidenceLabel(c: FactConfidence): { short: string; long: string } {
  switch (c) {
    case "asserted":
      return { short: "You told us", long: "You told us this directly" };
    case "inferred":
      return { short: "We figured out", long: "We figured this out from your other answers" };
    case "unknown":
      return { short: "Need answer", long: "We still need an answer for this" };
  }
}
