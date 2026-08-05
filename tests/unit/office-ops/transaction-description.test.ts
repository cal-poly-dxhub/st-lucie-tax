import { describe, expect, it, vi } from "vitest";

// admin.ts imports server/db.js at module load, which would open a real pool.
// Stub it — these tests only exercise the pure description-metadata helpers.
vi.mock("../../../services/office-ops/server/db.js", () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn(),
}));

import {
  extractSummary,
  mergeSummaryIntoDescription,
} from "../../../services/office-ops/server/routes/admin.js";

// A realistic description blob mirroring TransactionTypeMetadata.
const FULL_BLOB = JSON.stringify({
  summary: "Renew your driver license before it expires.",
  keywords: ["renew", "license", "dl"],
  commonPhrases: ["renew my license", "my license is expiring"],
  requiredDocumentSummary: "Bring your current license and proof of address.",
  requiredDocuments: ["current_license", "proof_address"],
  onlineEligible: true,
  onlineUrl: "https://example.gov/renew",
  relatedTransactionIds: ["dl-name-change"],
  relatedPrompts: { faq: "How long is it valid?" },
  notes: "Vision test may be required.",
});

describe("extractSummary", () => {
  it("returns the summary sub-field from a JSON blob", () => {
    expect(extractSummary(FULL_BLOB)).toBe("Renew your driver license before it expires.");
  });

  it("returns empty string for null", () => {
    expect(extractSummary(null)).toBe("");
  });

  it("returns empty string when the blob has no summary field", () => {
    expect(extractSummary(JSON.stringify({ keywords: ["x"] }))).toBe("");
  });

  it("treats a legacy plain-string description as the summary", () => {
    expect(extractSummary("just a plain sentence")).toBe("just a plain sentence");
  });
});

describe("mergeSummaryIntoDescription", () => {
  it("replaces ONLY the summary and preserves every structured sibling", () => {
    const merged = mergeSummaryIntoDescription(FULL_BLOB, "A brand-new summary line.");
    const parsed = JSON.parse(merged!);

    expect(parsed.summary).toBe("A brand-new summary line.");
    // The rest of the routing metadata must survive untouched.
    expect(parsed.keywords).toEqual(["renew", "license", "dl"]);
    expect(parsed.commonPhrases).toEqual(["renew my license", "my license is expiring"]);
    expect(parsed.requiredDocuments).toEqual(["current_license", "proof_address"]);
    expect(parsed.requiredDocumentSummary).toBe("Bring your current license and proof of address.");
    expect(parsed.onlineEligible).toBe(true);
    expect(parsed.onlineUrl).toBe("https://example.gov/renew");
    expect(parsed.relatedTransactionIds).toEqual(["dl-name-change"]);
    expect(parsed.relatedPrompts).toEqual({ faq: "How long is it valid?" });
    expect(parsed.notes).toBe("Vision test may be required.");
  });

  it("returns the existing value UNCHANGED when summary is undefined (COALESCE contract)", () => {
    expect(mergeSummaryIntoDescription(FULL_BLOB, undefined)).toBe(FULL_BLOB);
    expect(mergeSummaryIntoDescription(null, undefined)).toBeNull();
  });

  it("seeds a fresh {summary} blob when there is no existing description", () => {
    const merged = mergeSummaryIntoDescription(null, "New txn summary.");
    expect(JSON.parse(merged!)).toEqual({ summary: "New txn summary." });
  });

  it("does not throw on legacy non-JSON descriptions — starts a fresh blob", () => {
    const merged = mergeSummaryIntoDescription("legacy plain text", "Replacement summary.");
    // The legacy string was itself the summary being replaced, so nothing
    // structured is lost; result is a clean {summary} object.
    expect(JSON.parse(merged!)).toEqual({ summary: "Replacement summary." });
  });

  it("writes valid JSON even for an empty-string summary", () => {
    const merged = mergeSummaryIntoDescription(FULL_BLOB, "");
    const parsed = JSON.parse(merged!);
    expect(parsed.summary).toBe("");
    // Siblings still preserved.
    expect(parsed.keywords).toEqual(["renew", "license", "dl"]);
  });
});
