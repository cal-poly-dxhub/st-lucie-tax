/**
 * Decision-tree loader.
 * Reads all JSON files from data/decision-trees/ once per Lambda cold start.
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

function resolveDecisionTreesDir(): string {
  return resolve(resolveDataDir(), "decision-trees");
}

export function loadDecisionTrees(): Map<string, DecisionTree> {
  if (cache) return cache;
  const dirPath = resolveDecisionTreesDir();
  const trees = new Map<string, DecisionTree>();
  for (const file of readdirSync(dirPath)) {
    if (!file.endsWith(".json")) continue;
    const raw = readFileSync(resolve(dirPath, file), "utf-8");
    const tree = JSON.parse(raw) as DecisionTree;
    synthesizeBranchBlocking(tree);
    trees.set(tree.txnTypeId, tree);
  }
  cache = trees;
  return cache;
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
