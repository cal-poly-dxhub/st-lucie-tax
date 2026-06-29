/**
 * Tools for the resolve-facts state.
 *
 *   list_unresolved_facts:  returns facts required by the confirmed transactions
 *                            that are not yet answered (or are answered with
 *                            confidence='unknown').
 *
 *   resolve_decision_trees: traverses each confirmed transaction's tree with the
 *                            current facts map, aggregates baseItems + matching
 *                            branch addItems (minus removeItems), and splits the
 *                            output into three buckets (bring_in, optional_upload,
 *                            form) using item-catalog.json.
 *
 * Hard-block fail-fast: both entry points call `evaluateHardBlocks(session)`
 * first. If a branch with `blocking.severity === 'hard'` matches the current
 * fact state for an active transaction, that transaction is marked blocked
 * (with structured BlockingInfo) before anything else runs. Downstream code
 * treats blocked transactions as removed from the active set — their fact
 * requirements no longer appear in list_unresolved_facts, their items are
 * excluded from the bucket output, and their blocker surfaces to the UI via
 * session.structuredContext.transactions[i].blockingInfo.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type {
  Session,
  DecisionTree,
  DecisionTreeBranch,
  CatalogItem,
  FactDefinition,
  ResolvedItemsByBucket,
  BlockingInfo,
  TransactionContext,
} from "@st-lucie/shared-types";
import { loadFactDefinitions, getFactDefinition } from "../../data-loaders/fact-definitions.js";
import { loadItemCatalog, getCatalogItem } from "../../data-loaders/item-catalog.js";
import { getDecisionTree } from "../../data-loaders/decision-trees.js";
import { recordFactsTools, handleRecordFactsTool } from "../record-facts/tools.js";

export const resolveFactsTools: Tool[] = [
  {
    toolSpec: {
      name: "list_unresolved_facts",
      description:
        "List every fact the confirmed transactions' decision trees require that has not yet been answered. Returns the questionText the customer should be asked for each unresolved fact.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "resolve_decision_trees",
      description:
        "Evaluate every confirmed transaction's decision tree against the current facts map and return the final aggregate document/item list, split into three buckets: bring_in, optional_upload, form. Call this only after list_unresolved_facts returns an empty set.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  ...recordFactsTools,
];

interface ResolveResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export async function handleResolveFactsTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<ResolveResult> {
  switch (toolName) {
    case "list_unresolved_facts":
      return handleListUnresolvedFacts(session);
    case "resolve_decision_trees":
      return handleResolveDecisionTrees(session);
    case "record_facts":
      return handleRecordFactsTool(toolName, input, session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

function handleListUnresolvedFacts(session: Session): ResolveResult {
  loadFactDefinitions(); // warm cache

  // Fail-fast: evaluate hard-blocks first so newly-blocked transactions stop
  // contributing unresolved facts to this list.
  const newHardBlocks = evaluateHardBlocks(session);

  const activeTxnIds = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .map((t) => t.txnTypeId);

  const requiredKeys = collectRequiredFactKeys(activeTxnIds);
  const facts = session.structuredContext.facts;

  const unresolved = [...requiredKeys]
    .filter((k) => {
      const f = facts[k];
      return !f || f.confidence === "unknown";
    })
    .map((k) => {
      const def = getFactDefinition(k);
      if (!def) return null;
      return {
        factKey: def.factKey,
        label: def.label,
        questionText: def.questionText,
        allowedValues: def.allowedValues,
        inferenceHints: def.inferenceHints,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return {
    content: [
      {
        text: JSON.stringify({
          status: "ok",
          unresolvedCount: unresolved.length,
          totalRequired: requiredKeys.size,
          unresolved,
          hardBlocks: newHardBlocks.map((b) => ({
            txnTypeId: b.txnTypeId,
            reason: b.blocking.reason,
            customerMessage: b.blocking.customerMessage,
            nextSteps: b.blocking.nextSteps,
            // Curated authoritative links (e.g. the FLHSMV TLSAE page). Surfaced
            // so the bot can give the customer the exact link when it acknowledges
            // the block, instead of refusing ("I don't have access to links").
            sourceRefs: b.blocking.sourceRefs,
          })),
          guidance:
            unresolved.length === 0 && activeTxnIds.length > 0
              ? "All required facts are resolved. Call resolve_decision_trees to produce the final item list."
              : unresolved.length === 0 && activeTxnIds.length === 0
                ? "Every transaction is now blocked. Acknowledge the blocks to the customer and do NOT call resolve_decision_trees."
                : newHardBlocks.length > 0
                  ? "A transaction just hit a hard block. Acknowledge it to the customer (use the customerMessage + nextSteps) and continue with the remaining unresolved facts for other transactions."
                  : "Ask the customer about the unresolved facts, 1-2 at a time. Use record_facts to log each answer.",
        }),
      },
    ],
  };
}

function handleResolveDecisionTrees(session: Session): ResolveResult {
  loadItemCatalog(); // warm cache

  // Fail-fast before we compute required facts — a blocked transaction's
  // facts are not required, so hitting a block can flip a "missing-facts"
  // error into a clean resolution.
  const hardBlockHits = evaluateHardBlocks(session);

  const activeTxnIds = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .map((t) => t.txnTypeId);

  const requiredKeys = collectRequiredFactKeys(activeTxnIds);
  const facts = session.structuredContext.facts;

  const missing = [...requiredKeys].filter((k) => !facts[k] || facts[k].confidence === "unknown");
  if (missing.length > 0) {
    return {
      content: [
        {
          text: JSON.stringify({
            status: "blocked",
            reason: "missing-facts",
            missing,
            guidance: "Call list_unresolved_facts and ask the customer before retrying.",
          }),
        },
      ],
    };
  }

  const trees = activeTxnIds.map((id) => getDecisionTree(id)).filter((t): t is DecisionTree => !!t);

  const itemSet = new Set<string>();
  const removalSet = new Set<string>();
  const branchNotes: Array<{ txnTypeId: string; note: string }> = [];

  for (const tree of trees) {
    for (const baseId of tree.baseItems) {
      itemSet.add(baseId);
    }
    for (const branch of tree.branches) {
      if (!branchMatches(branch, facts)) continue;
      for (const addId of branch.addItems ?? []) itemSet.add(addId);
      for (const removeId of branch.removeItems ?? []) removalSet.add(removeId);
      if (branch.note) branchNotes.push({ txnTypeId: tree.txnTypeId, note: branch.note });
    }
  }

  // Hard-blocked transactions are skipped by the main loop above (their status
  // is already 'blocked'), but their triggering branch note is still
  // operationally important — surface it in branchNotes so downstream
  // consumers (the LLM, tests, audit trails) see a uniform record of every
  // matching branch regardless of whether the tree produced items.
  for (const hit of hardBlockHits) {
    if (hit.note) {
      branchNotes.push({ txnTypeId: hit.txnTypeId, note: hit.note });
    }
  }

  // Apply removals last so later branches can strip baseItems (e.g. swapping
  // passport for green card).
  for (const r of removalSet) itemSet.delete(r);

  const resolvedItems = [...itemSet]
    .map((id) => getCatalogItem(id))
    .filter((i): i is CatalogItem => !!i);

  const buckets: ResolvedItemsByBucket = {
    bringIns: resolvedItems.filter((i) => i.bucket === "bring_in"),
    optionalUploads: resolvedItems.filter((i) => i.bucket === "optional_upload"),
    forms: resolvedItems.filter((i) => i.bucket === "form"),
  };

  // Persist buckets on the session so the frontend can render them directly
  // from structuredContext. process-message.ts saves the session after the
  // tool chain completes, so no additional plumbing is required.
  session.structuredContext.resolvedBuckets = buckets;

  // Collect every currently-blocked transaction (whether blocked this turn or
  // on a prior turn) so the LLM + UI have the full picture.
  const blockedTxns = session.structuredContext.transactions
    .filter((t) => t.status === "blocked" && t.blockingInfo)
    .map((t) => ({
      txnTypeId: t.txnTypeId,
      name: t.name,
      reason: t.blockingInfo!.reason,
      customerMessage: t.blockingInfo!.customerMessage,
      nextSteps: t.blockingInfo!.nextSteps,
      sourceRefs: t.blockingInfo!.sourceRefs,
    }));

  // Missing-from-catalog sanity check for visibility.
  const missingFromCatalog = [...itemSet].filter((id) => !getCatalogItem(id));

  return {
    content: [
      {
        text: JSON.stringify({
          status: "ok",
          buckets: {
            bringIns: buckets.bringIns.map((i) => ({
              itemId: i.itemId,
              label: i.label,
              source: i.source,
              notes: i.notes,
            })),
            optionalUploads: buckets.optionalUploads.map((i) => ({
              itemId: i.itemId,
              label: i.label,
              source: i.source,
              notes: i.notes,
            })),
            forms: buckets.forms.map((i) => ({
              itemId: i.itemId,
              label: i.label,
              source: i.source,
              notes: i.notes,
            })),
          },
          branchNotes,
          blockedTransactions: blockedTxns,
          missingFromCatalog,
        }),
      },
    ],
    resolvedBuckets: buckets,
    branchNotes,
    shouldAdvance: true,
  };
}

export function collectRequiredFactKeysForActiveTxns(activeTxnIds: string[]): Set<string> {
  return collectRequiredFactKeys(activeTxnIds);
}

function collectRequiredFactKeys(activeTxnIds: string[]): Set<string> {
  const required = new Set<string>();
  for (const id of activeTxnIds) {
    const tree = getDecisionTree(id);
    if (!tree) continue;
    for (const fk of tree.factsRequired) required.add(fk);
    // Also require every factKey mentioned in a branch's `when` (defensive —
    // authors might forget to list a when-fact in factsRequired).
    for (const branch of tree.branches) {
      for (const fk of Object.keys(branch.when)) required.add(fk);
    }
  }
  return required;
}

function branchMatches(
  branch: DecisionTreeBranch,
  facts: Session["structuredContext"]["facts"],
): boolean {
  for (const [key, expected] of Object.entries(branch.when)) {
    const fact = facts[key];
    if (!fact) return false;
    if (fact.value !== expected) return false;
    if (fact.confidence === "unknown") return false;
  }
  return true;
}

/**
 * For every currently-active transaction, check whether any of its tree's
 * branches with a hard-severity `blocking` field matches the current facts.
 * If so, mutate that transaction in place to status='blocked' and attach a
 * structured BlockingInfo. Returns the list of transactions newly blocked by
 * this call (transactions blocked on prior turns are NOT re-reported).
 *
 * Safe to call multiple times per turn — it's idempotent.
 */
interface HardBlockHit {
  txnTypeId: string;
  blocking: BlockingInfo;
  /** Original branch note (if any) — surfaced back into `branchNotes` so
   * downstream consumers that scan the flat branchNotes array still see the
   * blocking message even though the blocked transaction's main tree loop is
   * skipped. */
  note?: string;
}

export function applyHardBlocksForSession(session: Session): HardBlockHit[] {
  return evaluateHardBlocks(session);
}

function evaluateHardBlocks(session: Session): HardBlockHit[] {
  const facts = session.structuredContext.facts;
  const newBlocks: HardBlockHit[] = [];

  for (const txn of session.structuredContext.transactions) {
    if (txn.status !== "active") continue;
    const tree = getDecisionTree(txn.txnTypeId);
    if (!tree) continue;

    for (const branch of tree.branches) {
      if (!branch.blocking || branch.blocking.severity !== "hard") continue;
      if (!branchMatches(branch, facts)) continue;

      const blockingInfo: BlockingInfo = {
        severity: "hard",
        reason: branch.blocking.reason,
        customerMessage: branch.blocking.customerMessage,
        nextSteps: branch.blocking.nextSteps,
        sourceRefs: branch.blocking.sourceRefs ?? branch.sourceRefs,
        origin: "decision-tree",
      };
      applyHardBlockToTransaction(txn, blockingInfo);
      newBlocks.push({
        txnTypeId: txn.txnTypeId,
        blocking: blockingInfo,
        note: branch.note,
      });
      break; // first matching hard block wins for this transaction
    }
  }

  return newBlocks;
}

/**
 * Shared helper used by the decision-tree hard-block path AND the
 * universal-blockers pre-check. Keeps the mutation in one place so future
 * blocker origins (pre-screen, SME override) stay consistent.
 */
export function applyHardBlockToTransaction(txn: TransactionContext, blocking: BlockingInfo): void {
  txn.status = "blocked";
  txn.blockedReason = blocking.customerMessage;
  txn.blockingInfo = blocking;
}

// Keep the exported types usable by callers and tests without re-importing.
export type { FactDefinition, CatalogItem, DecisionTree };
