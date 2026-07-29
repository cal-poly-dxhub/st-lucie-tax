/**
 * Decision-tree linter.
 *
 * Validates every tree in `services/chatbot/src/data/decision-trees/*.json`
 * against the fact definitions, item catalog, and citation surface. Runs in CI
 * via `npm run lint:trees`; exits non-zero on any violation.
 *
 * Checks:
 *   1. Every factKey in `factsRequired` + every branch's `when` is registered
 *      in fact-definitions.json.
 *   2. Every value in a branch's `when` is in that fact's `allowedValues`.
 *   3. Every itemId in `baseItems` / `addItems` / `removeItems` exists in
 *      item-catalog.json.
 *   4. Every `factDefinition.relevantTransactions` entry pointing at a tree
 *      implies the tree actually lists that factKey in `factsRequired`.
 *   5. Every tree's `sources.flhsmvVerified` URLs map to an ingested KB asset
 *      (via mapS3ToSource's inverse-check).
 *   6. Every branch has a `sourceRefs[]` with at least one URL, and every URL
 *      is either:
 *        - An ingested flhsmv-forms/flhsmv-pages/tcslc-docs/tcslc URL, OR
 *        - A statute URL in the MANUAL_STATUTES ingested set.
 *      NOTE: this check is skipped for the 3 legacy pilot trees (cdl,
 *      dl-transfer, vehicle-title-transfer) — they predate the sourceRefs
 *      requirement and will be backfilled separately.
 *   7. Every catalog item's `source` URL resolves through the KB citation
 *      surface (same check as rule 6).
 *   8. Every catalog item's `verified` field is an ISO date within the last
 *      365 days.
 *   9. (Opt-in, --check-urls) Every cited URL resolves with HTTP 200/301/302.
 *      Catches typos like `stlucieclerk.com` (403 squatter) vs `.gov` (real).
 *      Off by default so CI is fast and offline; run manually before major
 *      batches of authoring land. URL checks are cached for the run and
 *      concurrency-limited.
 *
 * Usage:
 *   npx tsx scripts/lint-decision-trees.ts                # offline checks only
 *   npx tsx scripts/lint-decision-trees.ts --check-urls   # also HEAD every URL
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// -----------------------------------------------------------------------------
// Types — duplicated minimally from shared-types so the linter has zero runtime
// deps on the compiled service package.

interface DecisionTreeBranch {
  when: Record<string, string>;
  addItems?: string[];
  removeItems?: string[];
  note?: string;
  sourceRefs?: string[];
}

interface DecisionTree {
  txnTypeId: string;
  baseItems: string[];
  factsRequired: string[];
  branches: DecisionTreeBranch[];
  sources: {
    spreadsheet?: string;
    flhsmvVerified?: string[];
    tcslcVerified?: string[];
    statutes?: string[];
    gpt?: string[];
  };
}

interface FactDefinition {
  factKey: string;
  label: string;
  allowedValues: string[];
  scope: "global" | "transaction-specific";
  relevantTransactions: string[];
  valueLabels?: Record<string, string>;
}

interface DocumentValidity {
  rule?: unknown;
  anchor?: unknown;
  days?: unknown;
  source?: unknown;
  appliesWhen?: unknown;
  contentChecks?: unknown;
}

interface CatalogItem {
  itemId: string;
  label: string;
  bucket: "bring_in" | "optional_upload" | "form";
  source?: string;
  verified?: string;
  notes?: string;
  validity?: DocumentValidity;
}

const VALIDITY_RULES = ["max-age", "unexpired"];
const VALIDITY_ANCHORS = ["issued", "dated", "signed", "expires"];

// -----------------------------------------------------------------------------
// Legacy pilots — predate the sourceRefs-per-branch requirement. They pass
// schema checks but skip the branch-level citation audit.

const LEGACY_PILOT_TREES = new Set(["cdl", "dl-transfer", "vehicle-title-transfer"]);

// -----------------------------------------------------------------------------
// Statute set ingested by the KB — must be kept in sync with
// scripts/scrape-kb-flhsmv.ts MANUAL_STATUTES. Linter uses this to verify
// statute citations resolve.

const INGESTED_STATUTES = new Set<string>([
  "322.031",
  "322.17",
  "322.21",
  "322.18",
  "322.53",
  "322.54",
  "322.142",
  "322.19",
  "319.23",
  "319.14",
  "320.02",
  "320.03",
  "320.0609",
  "320.072",
  "320.27",
  "320.0848",
  "627.733",
  "197.222",
  "197.252",
  "379.354",
  "328.72",
  // Concealed-weapon statutes (added by scrape-kb-fdacs-fwc.ts):
  "790.06",
  "790.0655",
  // DL sanctions / reinstatement (added by scrape-kb-sanctions-supplement.ts):
  "322.28",
  "322.2615",
  "322.291",
  "322.34",
]);

// -----------------------------------------------------------------------------
// Citation surface — inverse of mapS3ToSource. Given a citation URL, return
// true if it corresponds to a KB asset that would be ingested under our
// current scraper settings.

/**
 * Known external governmental/registered authorities that are legitimate
 * sources but live outside our KB scrape. Cited from item catalog entries
 * (e.g., Sunbiz for business registration verification, TSA for hazmat fees,
 * stlucieclerk for Declaration of Domicile). The chatbot still renders these
 * as clickable source links — they just aren't retrieved as KB context.
 */
const EXTERNAL_AUTHORITY_PATTERNS: RegExp[] = [
  /^https?:\/\/(www\.)?flhsmv\.gov\/fees\/?$/i,
  /^https?:\/\/(www\.)?flhsmv\.gov\/pdf\/forms\/[0-9A-Za-z_-]+\.pdf$/i, // duplicate of rule below, kept for clarity
  /^https?:\/\/(www\.)?flhsmv\.gov\/pdf\/proc\/[a-z]+\/[a-z0-9_-]+\.pdf$/i, // FLHSMV procedural docs (e.g. /pdf/proc/rs/rs-43.pdf)
  /^https?:\/\/(www\.)?tsa\.gov\/for-industry\/hazmat-endorsement\/?$/i,
  /^https?:\/\/search\.sunbiz\.org(\/.*)?$/i,
  /^https?:\/\/(www\.)?stlucieclerk\.gov(\/.*)?$/i,
  /^https?:\/\/(www\.)?mydmvportal\.flhsmv\.gov(\/.*)?$/i,
  /^https?:\/\/(www\.)?paslc\.gov(\/.*)?$/i, // Property Appraiser St. Lucie County
  /^https?:\/\/(www\.)?myfwc\.com(\/.*)?$/i, // Fish & Wildlife Conservation Commission (hunting/fishing)
  /^https?:\/\/(www\.)?fdacs\.gov(\/.*)?$/i, // Dept of Agriculture & Consumer Services (CCW licensing)
  /^https?:\/\/tcslc\.sharepoint\.com(\/.*)?$/i, // FLHSMV Operations Manual mirror (vendor-provided, ingested as flhsmv-ops-manual/)
  /^https?:\/\/(www\.)?form\.jotform\.com\/[0-9]+$/i, // tcslc-hosted JotForm forms (Tourist Tax Inactive form, etc.)
];

function isIngestedCitation(url: string): boolean {
  if (!url) return false;

  // External-authority allowlist
  if (EXTERNAL_AUTHORITY_PATTERNS.some((rx) => rx.test(url))) {
    return true;
  }

  // flhsmv-forms/{formNumber}.pdf
  if (/^https?:\/\/(www\.)?flhsmv\.gov\/pdf\/forms\/[0-9A-Za-z_-]+\.pdf$/i.test(url)) {
    return true;
  }

  // flhsmv-pages/{slug}.txt — any path under flhsmv.gov that isn't a PDF
  // Covers /driver-licenses-id-cards/*, /motor-vehicles-tags-titles/*, etc.
  // Drop trailing slash + fragment before testing.
  if (/^https?:\/\/(www\.)?flhsmv\.gov\/[a-z0-9/-]+\/?$/i.test(url)) {
    return true;
  }

  // Florida Statutes — flsenate.gov/Laws/Statutes/YYYY/{chapter}.{section}
  const statuteMatch = url.match(
    /^https?:\/\/(www\.)?flsenate\.gov\/Laws\/Statutes\/\d{4}\/([0-9]+\.[0-9A-Za-z]+)/i,
  );
  if (statuteMatch) {
    return INGESTED_STATUTES.has(statuteMatch[2]);
  }

  // tcslc.com page — /<id>/Slug (content pages)
  if (/^https?:\/\/(www\.)?tcslc\.com\/\d+(\/[^?]*)?$/i.test(url)) {
    return true;
  }

  // tcslc.com DocumentCenter PDF — /DocumentCenter/View/{id}
  if (/^https?:\/\/(www\.)?tcslc\.com\/DocumentCenter\/View\/\d+/i.test(url)) {
    return true;
  }

  return false;
}

// -----------------------------------------------------------------------------

interface Violation {
  treeId: string;
  item: string;
  reason: string;
  /**
   * 'error' (default) fails the lint; 'warn' is advisory and does not fail CI.
   * Used for migration-nudge rules like "BLOCKED: notes should have structured
   * blocking fields" that we don't want to block merges on yet.
   */
  severity?: "error" | "warn";
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function lintOneTree(
  tree: DecisionTree,
  factsByKey: Map<string, FactDefinition>,
  itemsById: Map<string, CatalogItem>,
): Violation[] {
  const v: Violation[] = [];
  const treeId = tree.txnTypeId;

  // 1. factsRequired must all be registered
  for (const fk of tree.factsRequired) {
    if (!factsByKey.has(fk)) {
      v.push({
        treeId,
        item: `factsRequired[${fk}]`,
        reason: "factKey not in fact-definitions.json",
      });
    }
  }

  // 2. branches: when-keys registered, when-values allowed, items registered, sourceRefs present
  tree.branches.forEach((branch, idx) => {
    // when-keys
    for (const whenKey of Object.keys(branch.when)) {
      const def = factsByKey.get(whenKey);
      if (!def) {
        v.push({
          treeId,
          item: `branch[${idx}].when[${whenKey}]`,
          reason: "factKey not in fact-definitions.json",
        });
        continue;
      }
      const whenValue = branch.when[whenKey];
      if (!def.allowedValues.includes(whenValue)) {
        v.push({
          treeId,
          item: `branch[${idx}].when[${whenKey}]`,
          reason: `value "${whenValue}" not in allowedValues: ${def.allowedValues.join(", ")}`,
        });
      }
    }

    // items
    for (const itemId of branch.addItems ?? []) {
      if (!itemsById.has(itemId)) {
        v.push({
          treeId,
          item: `branch[${idx}].addItems[${itemId}]`,
          reason: "itemId not in item-catalog.json",
        });
      }
    }
    for (const itemId of branch.removeItems ?? []) {
      if (!itemsById.has(itemId)) {
        v.push({
          treeId,
          item: `branch[${idx}].removeItems[${itemId}]`,
          reason: "itemId not in item-catalog.json",
        });
      }
    }

    // Advisory: branches whose note starts with "BLOCKED:" should eventually
    // move the blocker info into a structured `blocking` field so the synthesis
    // step in the tree loader isn't relied on forever. Warn, don't fail.
    const rawBranch = branch as unknown as { blocking?: unknown };
    if (branch.note?.trim().startsWith("BLOCKED") && !rawBranch.blocking) {
      v.push({
        treeId,
        item: `branch[${idx}]`,
        reason:
          "BLOCKED: note present without structured `blocking` field — loader will synthesize one, but author should migrate this to `blocking: { severity, reason, customerMessage, nextSteps }` directly.",
        severity: "warn",
      });
    }

    // sourceRefs — required on new trees, not on legacy pilots
    if (!LEGACY_PILOT_TREES.has(treeId)) {
      const refs = branch.sourceRefs ?? [];
      if (refs.length === 0) {
        v.push({
          treeId,
          item: `branch[${idx}]`,
          reason: "sourceRefs[] is empty — every branch needs at least one citation",
        });
      }
      for (const url of refs) {
        if (!isIngestedCitation(url)) {
          v.push({
            treeId,
            item: `branch[${idx}].sourceRefs`,
            reason: `citation not in ingested KB: ${url}`,
          });
        }
      }
    }
  });

  // 3. baseItems registered
  for (const itemId of tree.baseItems) {
    if (!itemsById.has(itemId)) {
      v.push({ treeId, item: `baseItems[${itemId}]`, reason: "itemId not in item-catalog.json" });
    }
  }

  // 5. sources.flhsmvVerified must map to ingested citations
  for (const url of tree.sources.flhsmvVerified ?? []) {
    if (!isIngestedCitation(url)) {
      v.push({ treeId, item: "sources.flhsmvVerified", reason: `url not in ingested KB: ${url}` });
    }
  }
  for (const url of tree.sources.tcslcVerified ?? []) {
    if (!isIngestedCitation(url)) {
      v.push({ treeId, item: "sources.tcslcVerified", reason: `url not in ingested KB: ${url}` });
    }
  }
  for (const url of tree.sources.statutes ?? []) {
    if (!isIngestedCitation(url)) {
      v.push({ treeId, item: "sources.statutes", reason: `url not in ingested KB: ${url}` });
    }
  }

  return v;
}

function lintFactDefinitionsAgainstTrees(
  defs: FactDefinition[],
  trees: DecisionTree[],
): Violation[] {
  const v: Violation[] = [];
  const treesByTxnTypeId = new Map(trees.map((t) => [t.txnTypeId, t]));

  // 4. If a fact says it's relevant to a transaction, the tree should list it
  for (const def of defs) {
    if (def.scope !== "transaction-specific") continue;
    for (const txnTypeId of def.relevantTransactions) {
      const tree = treesByTxnTypeId.get(txnTypeId);
      if (!tree) continue; // tree may not exist yet — skip
      if (!tree.factsRequired.includes(def.factKey)) {
        v.push({
          treeId: "(fact-definitions)",
          item: def.factKey,
          reason: `relevantTransactions includes "${txnTypeId}" but that tree's factsRequired does NOT list ${def.factKey}`,
        });
      }
    }
  }

  // valueLabels keys must all be in allowedValues
  for (const def of defs) {
    if (!def.valueLabels) continue;
    const allowed = new Set(def.allowedValues);
    for (const labelKey of Object.keys(def.valueLabels)) {
      if (!allowed.has(labelKey)) {
        v.push({
          treeId: "(fact-definitions)",
          item: def.factKey,
          reason: `valueLabels key "${labelKey}" is not in allowedValues: ${def.allowedValues.join(", ")}`,
        });
      }
    }
  }
  return v;
}

function lintCatalogItems(items: CatalogItem[]): Violation[] {
  const v: Violation[] = [];
  const now = Date.now();
  const yearMs = 365 * 24 * 60 * 60 * 1000;

  for (const item of items) {
    // 7. source URL must be an ingested citation (when source is set)
    if (item.source) {
      if (!isIngestedCitation(item.source)) {
        v.push({
          treeId: "(item-catalog)",
          item: item.itemId,
          reason: `source URL not in ingested KB: ${item.source}`,
        });
      }
    }
    // 8. verified date within 365 days
    if (item.verified) {
      const date = Date.parse(item.verified);
      if (Number.isNaN(date)) {
        v.push({
          treeId: "(item-catalog)",
          item: item.itemId,
          reason: `verified field is not a valid ISO date: ${item.verified}`,
        });
      } else if (now - date > yearMs) {
        const ageDays = Math.floor((now - date) / (24 * 60 * 60 * 1000));
        v.push({
          treeId: "(item-catalog)",
          item: item.itemId,
          reason: `verified date is ${ageDays} days old (>365) — needs re-verification`,
        });
      }
    }
    // 10. validity rule (uploaded-doc expiry/recency) — schema + governance.
    if (item.validity !== undefined) {
      const val = item.validity;
      const flag = (reason: string) =>
        v.push({ treeId: "(item-catalog)", item: item.itemId, reason });
      const okKeywords = (aw: unknown) =>
        Array.isArray(aw) &&
        aw.length > 0 &&
        aw.every((k) => typeof k === "string" && k.trim() !== "");
      if (typeof val !== "object" || val === null) {
        flag("validity must be an object");
      } else {
        const hasDateRule = val.rule !== undefined;
        const hasContentChecks = val.contentChecks !== undefined;
        // A validity object must do at least one of the two things.
        if (!hasDateRule && !hasContentChecks) {
          flag("validity must define a date rule (rule/anchor) and/or contentChecks");
        }
        // Date-rule fields — validated only when a date rule is present.
        if (hasDateRule) {
          if (!VALIDITY_RULES.includes(val.rule as string)) {
            flag(
              `validity.rule must be one of ${VALIDITY_RULES.join("|")} (got ${JSON.stringify(val.rule)})`,
            );
          }
          if (!VALIDITY_ANCHORS.includes(val.anchor as string)) {
            flag(
              `validity.anchor must be one of ${VALIDITY_ANCHORS.join("|")} (got ${JSON.stringify(val.anchor)})`,
            );
          }
          if (val.rule === "max-age" && !(typeof val.days === "number" && val.days > 0)) {
            flag(
              `validity.days must be a positive number when rule is 'max-age' (got ${JSON.stringify(val.days)})`,
            );
          }
          // 'unexpired' only makes sense with anchor 'expires' (see engine).
          if (val.rule === "unexpired" && val.anchor !== "expires") {
            flag(
              `validity.anchor must be 'expires' when rule is 'unexpired' (got ${JSON.stringify(val.anchor)})`,
            );
          }
          if (val.appliesWhen !== undefined && !okKeywords(val.appliesWhen)) {
            flag(
              "validity.appliesWhen must be a non-empty array of non-empty strings when present",
            );
          }
          // Governance: a date rule must cite an authoritative basis.
          if (typeof val.source !== "string" || (val.source as string).trim() === "") {
            flag(
              "validity.source is required for a date rule (cite the FLHSMV/tcslc/statute basis)",
            );
          }
        }
        // Content checks — validated only when present.
        if (hasContentChecks) {
          const cc = val.contentChecks;
          if (!Array.isArray(cc) || cc.length === 0) {
            flag("validity.contentChecks must be a non-empty array when present");
          } else {
            cc.forEach((c: unknown, i: number) => {
              const obj = c as {
                requiredAttribute?: unknown;
                source?: unknown;
                appliesWhen?: unknown;
              };
              if (
                typeof obj?.requiredAttribute !== "string" ||
                obj.requiredAttribute.trim() === ""
              ) {
                flag(
                  `validity.contentChecks[${i}].requiredAttribute is required (non-empty string)`,
                );
              }
              if (typeof obj?.source !== "string" || obj.source.trim() === "") {
                flag(`validity.contentChecks[${i}].source is required (cite the basis)`);
              }
              if (obj?.appliesWhen !== undefined && !okKeywords(obj.appliesWhen)) {
                flag(
                  `validity.contentChecks[${i}].appliesWhen must be a non-empty array of non-empty strings`,
                );
              }
            });
          }
        }
      }
    }
  }
  return v;
}

// -----------------------------------------------------------------------------
// Rule 9: URL reachability — opt-in via --check-urls.

interface UrlRef {
  treeId: string;
  item: string;
  url: string;
}

function collectAllUrls(trees: DecisionTree[], items: CatalogItem[]): UrlRef[] {
  const refs: UrlRef[] = [];
  for (const tree of trees) {
    for (const url of tree.sources.flhsmvVerified ?? [])
      refs.push({ treeId: tree.txnTypeId, item: "sources.flhsmvVerified", url });
    for (const url of tree.sources.tcslcVerified ?? [])
      refs.push({ treeId: tree.txnTypeId, item: "sources.tcslcVerified", url });
    for (const url of tree.sources.statutes ?? [])
      refs.push({ treeId: tree.txnTypeId, item: "sources.statutes", url });
    tree.branches.forEach((branch, idx) => {
      for (const url of branch.sourceRefs ?? [])
        refs.push({ treeId: tree.txnTypeId, item: `branch[${idx}].sourceRefs`, url });
    });
  }
  for (const it of items) {
    if (it.source) refs.push({ treeId: "(item-catalog)", item: it.itemId, url: it.source });
  }
  return refs;
}

/**
 * HEAD every distinct URL with a short timeout. Treats 200–399 as reachable
 * and anything else (4xx, 5xx, network) as a violation. Concurrency capped
 * so we don't hammer flhsmv.gov or flsenate.gov. Results are deduplicated —
 * a URL cited in 20 places is only fetched once.
 */
async function checkUrls(
  refs: UrlRef[],
  opts: { concurrency: number; timeoutMs: number } = { concurrency: 8, timeoutMs: 15000 },
): Promise<Violation[]> {
  const distinct = new Map<string, UrlRef[]>();
  for (const ref of refs) {
    const arr = distinct.get(ref.url);
    if (arr) arr.push(ref);
    else distinct.set(ref.url, [ref]);
  }
  const urls = [...distinct.keys()];
  console.log(`\nChecking ${urls.length} distinct URL(s) (from ${refs.length} citations)...`);

  const violations: Violation[] = [];
  const statuses = new Map<string, { ok: boolean; detail: string }>();

  async function probe(url: string): Promise<void> {
    // SharePoint URLs are auth-walled — any HEAD/GET returns 302 to login.
    // We've ingested the underlying content via flhsmv-ops-manual/; the URL
    // itself is a pointer for auditors who have access. Treat as reachable.
    if (/^https?:\/\/tcslc\.sharepoint\.com/i.test(url)) {
      statuses.set(url, { ok: true, detail: "skipped (sharepoint auth-walled)" });
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    try {
      // Some servers block HEAD; fall back to GET. flsenate.gov is a known
      // HEAD-rejector. Prefer HEAD first for speed, retry with GET on 4xx/5xx.
      let res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ac.signal,
        headers: { "User-Agent": "StLucieTaxBot/1.0 (lint-decision-trees)" },
      });
      if (!res.ok) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: ac.signal,
          headers: { "User-Agent": "StLucieTaxBot/1.0 (lint-decision-trees)" },
        });
      }
      clearTimeout(timer);
      const ok = res.ok; // status in 200–299 after redirect
      statuses.set(url, { ok, detail: `HTTP ${res.status}` });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      statuses.set(url, { ok: false, detail: `network error: ${msg}` });
    }
  }

  // Simple pool-style concurrency
  const queue = urls.slice();
  const workers: Promise<void>[] = [];
  let done = 0;
  for (let i = 0; i < opts.concurrency; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const url = queue.shift()!;
          await probe(url);
          done += 1;
          process.stdout.write(`\r  ${done}/${urls.length}`);
        }
      })(),
    );
  }
  await Promise.all(workers);
  process.stdout.write("\n");

  for (const [url, result] of statuses.entries()) {
    if (result.ok) continue;
    for (const ref of distinct.get(url) ?? []) {
      violations.push({
        treeId: ref.treeId,
        item: ref.item,
        reason: `URL unreachable (${result.detail}): ${url}`,
      });
    }
  }
  return violations;
}

// -----------------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const doUrlCheck = args.has("--check-urls");

  const dataDir = resolve(ROOT, "services/chatbot/src/data");

  // Load data
  const treeDir = resolve(dataDir, "decision-trees");
  const trees: DecisionTree[] = readdirSync(treeDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadJson<DecisionTree>(resolve(treeDir, f)));

  const facts = loadJson<FactDefinition[]>(resolve(dataDir, "fact-definitions.json"));
  const items = loadJson<CatalogItem[]>(resolve(dataDir, "item-catalog.json"));

  const factsByKey = new Map(facts.map((f) => [f.factKey, f]));
  const itemsById = new Map(items.map((i) => [i.itemId, i]));

  // Run all checks
  const violations: Violation[] = [];
  for (const tree of trees) {
    violations.push(...lintOneTree(tree, factsByKey, itemsById));
  }
  violations.push(...lintFactDefinitionsAgainstTrees(facts, trees));
  violations.push(...lintCatalogItems(items));

  if (doUrlCheck) {
    const urlRefs = collectAllUrls(trees, items);
    violations.push(...(await checkUrls(urlRefs)));
  }

  // Report — warnings surface but don't fail CI; only errors do.
  const errors = violations.filter((v) => (v.severity ?? "error") === "error");
  const warnings = violations.filter((v) => v.severity === "warn");

  console.log(
    `\nChecked ${trees.length} trees, ${facts.length} fact defs, ${items.length} catalog items${doUrlCheck ? " (with URL reachability)" : ""}.`,
  );

  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s) (non-fatal):\n`);
    for (const v of warnings) {
      console.log(`  [warn] ${v.treeId.padEnd(22)} | ${v.item.padEnd(36)} | ${v.reason}`);
    }
  }

  if (errors.length === 0) {
    console.log("\nAll decision-tree lints passed.");
    return;
  }

  console.log(`\n${errors.length} error(s):\n`);
  for (const v of errors) {
    console.log(`  ${v.treeId.padEnd(28)} | ${v.item.padEnd(44)} | ${v.reason}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
