/**
 * Document uploadability classification.
 *
 * Primary source of truth is `item-catalog.json` — if the document string
 * matches a catalog label, the catalog's `bucket` decides. Falls back to a
 * legacy pattern matcher for documentType strings not yet covered by the
 * catalog (e.g. transactions without a decision tree).
 *
 * Legacy patterns verified against tcslc.com (April 2026 audit):
 *   - Insurance proof: no "original" language, electronically verifiable
 *   - Registration copies: site says "copy" acceptable (page 195)
 *   - Lienholder info: site accepts "letter" or "copy" (page 197)
 *   - Military orders: site explicitly says "copy" (page 197)
 */

import type { Session } from "@st-lucie/shared-types";
import { loadItemCatalog } from "../../data-loaders/item-catalog.js";

export function isUploadable(docName: string): boolean {
  const catalogBucket = lookupCatalogBucket(docName);
  if (catalogBucket === "optional_upload") return true;
  if (catalogBucket === "bring_in" || catalogBucket === "form") return false;

  const s = docName.toLowerCase();
  if (s.includes("insurance") && !s.includes("lien")) return true;
  if (s.includes("previous") && s.includes("registration")) return true;
  if (s.includes("current") && s.includes("registration") && !s.includes("title")) return true;
  if (s.includes("renewal notice")) return true;
  if (s.includes("lienholder")) return true;
  if (s.includes("lien") && s.includes("information")) return true;
  if (s.includes("military orders")) return true;
  return false;
}

/**
 * Match a freeform documentType string to a catalog item by substring.
 * Returns the item's bucket, or null if no match.
 */
export function lookupCatalogBucket(
  docName: string,
): "bring_in" | "optional_upload" | "form" | null {
  const catalog = loadItemCatalog();
  const lower = docName.toLowerCase();

  let best: { bucket: "bring_in" | "optional_upload" | "form"; score: number } | null = null;
  for (const item of catalog) {
    const label = item.label.toLowerCase();
    const short = label.split("(")[0].trim();
    let score = 0;
    if (lower === label || lower === short) score = 100;
    else if (lower.includes(short) || short.includes(lower)) score = short.length;
    if (score > 0 && (!best || score > best.score)) {
      best = { bucket: item.bucket, score };
    }
  }
  return best?.bucket ?? null;
}

/**
 * True iff at least one pending document in the session can be uploaded.
 * Used by the state machine to auto-skip the upload-docs state when
 * everything left must be brought in person.
 *
 * AUTHORITATIVE SOURCE: `resolvedBuckets.optionalUploads`. resolve-facts (order
 * 3) resolves the decision tree into the same three buckets the UI renders, so
 * by the time the machine is deciding upload-docs (order 5) this is populated
 * and is exactly the set of items the upload widgets will show. We trust it
 * directly — its items were already bucketed from item-catalog.json.
 *
 * FALLBACK (only when buckets aren't resolved yet — e.g. a txn with no decision
 * tree, or a code path that reaches here pre-resolution): classify the coarse
 * `documents[]` summary strings seeded at identify time. Those strings are the
 * transaction-types.json `requiredDocuments` blurbs, which rarely substring-
 * match a catalog label, so this path relies on the legacy pattern matcher in
 * isUploadable() for the handful of always-uploadable doc kinds (insurance,
 * registration copies, military orders). Historically this fallback WAS the
 * whole function — which meant the 2026-07 catalog flip (43 items -> optional_
 * upload) had no effect on this gate, and upload-docs was wrongly auto-skipped
 * for id-card and every other flipped transaction whose seed blurbs don't match
 * a catalog item. Reading resolvedBuckets first is the fix.
 */
export function anyDocumentIsUploadable(session: Session): boolean {
  const buckets = session.structuredContext.resolvedBuckets;
  if (buckets) {
    return buckets.optionalUploads.some((item) => {
      const lower = item.label.toLowerCase();
      // The DL is handled in verify-identity, never in upload-docs.
      return !lower.includes("driver license") && !lower.includes("driver's license");
    });
  }

  const docs = session.structuredContext.documents.filter((d) => {
    if (d.status !== "pending") return false;
    const lower = d.documentType.toLowerCase();
    // The DL was already handled in verify-identity.
    return !lower.includes("driver license") && !lower.includes("driver's license");
  });
  return docs.some((d) => isUploadable(d.documentType));
}
