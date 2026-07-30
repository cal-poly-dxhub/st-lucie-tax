/**
 * Decision-tree loader with database support.
 * Attempts to load approved trees from the database; falls back to filesystem.
 *
 * On load, any branch whose `note` starts with "BLOCKED:" but lacks a structured
 * `blocking` field is given a synthesized hard-severity BlockingInfo derived
 * from the note text. This lets the 46 legacy BLOCKED branches gain first-class
 * blocker behavior without being rewritten by hand.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionTree, DecisionTreeBranch } from "@st-lucie/shared-types";
import { resolveDataDir } from "./resolve-data-dir.js";

let cache: Map<string, DecisionTree> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // Re-check DB every 60s

function resolveDecisionTreesDir(): string {
  return resolve(resolveDataDir(), "decision-trees");
}

/**
 * Load decision trees from the filesystem (original behavior).
 */
function loadFromFilesystem(): Map<string, DecisionTree> {
  const dirPath = resolveDecisionTreesDir();
  const trees = new Map<string, DecisionTree>();
  for (const file of readdirSync(dirPath)) {
    if (!file.endsWith(".json")) continue;
    const raw = readFileSync(resolve(dirPath, file), "utf-8");
    const tree = JSON.parse(raw) as DecisionTree;
    synthesizeBranchBlocking(tree);
    trees.set(tree.txnTypeId, tree);
  }
  return trees;
}

/**
 * Try to load approved trees from the database.
 * Returns null if the database is not available or no trees exist.
 */
async function loadFromDatabase(): Promise<Map<string, DecisionTree> | null> {
  try {
    // Dynamically import to avoid hard dependency — if data-access isn't available, fall back
    const { getPool } = await import("@st-lucie/data-access");
    const pool = getPool();
    const { rows } = await pool.query<{ tree_id: string; content: DecisionTree }>(
      `SELECT tree_id, content FROM decision_trees WHERE status = 'approved'`,
    );
    if (rows.length === 0) return null;
    const trees = new Map<string, DecisionTree>();
    for (const row of rows) {
      const tree = row.content;
      tree.txnTypeId = row.tree_id; // Ensure consistency
      synthesizeBranchBlocking(tree);
      trees.set(tree.txnTypeId, tree);
    }
    return trees;
  } catch {
    // Database not available — fall back to filesystem
    return null;
  }
}

/**
 * Load all decision trees. Tries database first, then filesystem.
 * Results are cached with a TTL for DB freshness.
 */
export function loadDecisionTrees(): Map<string, DecisionTree> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cache;

  // Synchronous load from filesystem (cold start or fallback)
  const fsTrees = loadFromFilesystem();
  cache = fsTrees;
  cacheTimestamp = Date.now();

  // Asynchronously try to overlay DB trees (non-blocking)
  loadFromDatabase()
    .then((dbTrees) => {
      if (dbTrees && dbTrees.size > 0) {
        // Merge: DB trees override filesystem trees for matching IDs
        const merged = new Map(fsTrees);
        for (const [id, tree] of dbTrees) {
          merged.set(id, tree);
        }
        cache = merged;
        cacheTimestamp = Date.now();
      }
    })
    .catch(() => {
      // Silently ignore — filesystem fallback is already in place
    });

  return cache;
}

/**
 * Force-refresh the cache. Call after admin approves/modifies a tree.
 */
export function invalidateDecisionTreeCache(): void {
  cache = null;
  cacheTimestamp = 0;
}

export function getDecisionTree(txnTypeId: string): DecisionTree | undefined {
  return loadDecisionTrees().get(txnTypeId);
}

/**
 * For each branch whose note begins with "BLOCKED:" and has no structured
 * `blocking` field yet, derive a hard-severity BlockingInfo from the note.
 * The whole note (minus the prefix) becomes the customerMessage; if a trailing
 * "Contact..." / "Call..." / "Visit..." sentence is present it's lifted into
 * nextSteps for a cleaner UI presentation. branch.sourceRefs fall through.
 */
function synthesizeBranchBlocking(tree: DecisionTree): void {
  for (const branch of tree.branches) {
    if (branch.blocking) continue;
    const note = branch.note?.trim();
    if (!note || !note.startsWith("BLOCKED")) continue;

    // Heuristic: a branch that BOTH adds/removes items AND has a BLOCKED note
    // is really a redirect (e.g. "BLOCKED for renewal — re-apply as Original,
    // here are the items you'll need"). That's conditional, not hard. Hard
    // blocks offer nothing — the branch has no items, only a note.
    const hasItems = (branch.addItems?.length ?? 0) + (branch.removeItems?.length ?? 0) > 0;
    const severity: "hard" | "conditional" = hasItems ? "conditional" : "hard";

    // Strip the "BLOCKED:" or "BLOCKED for X:" prefix.
    const body = note.replace(/^BLOCKED[^:]*:\s*/, "").trim();
    const { customerMessage, nextSteps } = splitNextSteps(body);

    branch.blocking = {
      severity,
      reason: reasonFromBranch(branch),
      customerMessage,
      nextSteps,
      sourceRefs: branch.sourceRefs,
    };
  }
}

/**
 * Extract a terminal actionable sentence as nextSteps if one is present.
 * Matches phrases like "Contact X at ...", "Call ...", "Visit ...".
 */
function splitNextSteps(body: string): { customerMessage: string; nextSteps?: string } {
  // Look for the last sentence that reads like an action directive.
  const sentences = body.split(/(?<=[.!?])\s+/);
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (
      /^\s*(Contact|Call|Visit|Go to|See |Apply at|Schedule|Return|Reschedule|Resolve)\b/i.test(
        sentences[i],
      )
    ) {
      const nextSteps = sentences.slice(i).join(" ").trim();
      const customerMessage = sentences.slice(0, i).join(" ").trim();
      if (customerMessage) return { customerMessage, nextSteps };
    }
  }
  return { customerMessage: body };
}

/**
 * Produce a short machine-readable reason tag by joining the branch's `when`
 * keys/values. Used for analytics + UI de-duplication.
 */
function reasonFromBranch(branch: DecisionTreeBranch): string {
  return Object.entries(branch.when)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}
