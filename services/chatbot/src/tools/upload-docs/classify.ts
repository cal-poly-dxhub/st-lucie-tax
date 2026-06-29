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
 */
export function anyDocumentIsUploadable(session: Session): boolean {
  const docs = session.structuredContext.documents.filter((d) => {
    if (d.status !== "pending") return false;
    const lower = d.documentType.toLowerCase();
    // The DL was already handled in verify-identity.
    return !lower.includes("driver license") && !lower.includes("driver's license");
  });
  return docs.some((d) => isUploadable(d.documentType));
}
