/**
 * Tools for the identify-transaction state.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type {
  IdentifiedTransaction,
  TransactionType,
  TransactionTypeMetadata,
  Session,
} from "@st-lucie/shared-types";
import { getPool } from "@st-lucie/data-access";

const DEFAULT_METADATA: TransactionTypeMetadata = {
  summary: "",
  keywords: [],
  commonPhrases: [],
  requiredDocumentSummary: "",
  requiredDocuments: [],
  onlineEligible: false,
  relatedTransactionIds: [],
  relatedPrompts: {},
  notes: "",
};

function parseDescription(raw: string | null): TransactionTypeMetadata {
  if (!raw) return DEFAULT_METADATA;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_METADATA, ...parsed };
  } catch {
    return { ...DEFAULT_METADATA, summary: raw };
  }
}
import { queryKnowledgeBase } from "../../knowledge-base/query.js";
import { classifyIntentTools, handleClassifyIntentTool } from "../classify-intent/tools.js";
import {
  suggestTransactionsTools,
  handleSuggestTransactionsTool,
} from "../suggest-transactions/tools.js";
import { recordFactsTools, handleRecordFactsTool } from "../record-facts/tools.js";

let cachedTypes: TransactionType[] | null = null;

async function loadTransactionTypes(): Promise<TransactionType[]> {
  if (cachedTypes) return cachedTypes;

  const pool = getPool();
  const result = await pool.query<{
    txn_type_id: string;
    name: string;
    description: string | null;
    avg_duration_min: number;
    available_from: string | null;
    available_until: string | null;
    status: string;
  }>(
    `SELECT txn_type_id, name, description, avg_duration_min, available_from, available_until, status
     FROM transaction_types
     WHERE office_id IS NULL
     ORDER BY name`,
  );

  cachedTypes = result.rows.map((row) => ({
    txnTypeId: row.txn_type_id,
    name: row.name,
    description: parseDescription(row.description),
    averageDurationMinutes: row.avg_duration_min,
    serviceHours:
      row.available_from && row.available_until
        ? { start: row.available_from, end: row.available_until }
        : undefined,
    status: row.status as TransactionType["status"],
  }));

  return cachedTypes;
}

export const identifyTransactionTools: Tool[] = [
  {
    toolSpec: {
      name: "search_transactions",
      description:
        "Search the transaction type catalog to find services that match what the customer describes. Returns all active transaction types with their metadata. Call this when the customer first describes what they need.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The customer's description of what they need",
            },
          },
          required: ["query"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_transaction_details",
      description:
        "Get full details for a specific transaction type including required documents, related transactions, and whether it can be done online.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            transactionTypeId: {
              type: "string",
              description: 'The transaction type ID (e.g., "dl-transfer")',
            },
          },
          required: ["transactionTypeId"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "query_knowledge_base",
      description:
        "Search the St. Lucie County Tax Collector knowledge base for general information. Use this when the customer asks a question that doesn't match any specific transaction type — such as office hours, accepted payment methods, general policies, or 'how do I...' questions. Do NOT use this for transaction identification.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The customer's question to search for",
            },
          },
          required: ["query"],
        },
      },
    },
  },
  ...classifyIntentTools,
  ...suggestTransactionsTools,
  ...recordFactsTools,
  {
    toolSpec: {
      name: "confirm_selections",
      description:
        "Record the customer's confirmed transaction selections. Call this after identifying all services the customer needs.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            transactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  transactionTypeId: { type: "string" },
                },
                required: ["transactionTypeId"],
              },
              description: "List of confirmed transaction type IDs",
            },
          },
          required: ["transactions"],
        },
      },
    },
  },
];

export interface ToolCallResult {
  content: ToolResultContentBlock[];
  confirmed?: IdentifiedTransaction[];
  combinedDocuments?: string[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export async function handleIdentifyTransactionTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<ToolCallResult> {
  switch (toolName) {
    case "search_transactions":
      return handleSearch();
    case "get_transaction_details":
      return handleGetDetails(input.transactionTypeId as string);
    case "query_knowledge_base":
      return handleKBQuery(input.query as string);
    case "confirm_selections":
      return handleConfirm(input.transactions as Array<{ transactionTypeId: string }>, session);
    case "classify_intent":
      return handleClassifyIntentTool(toolName, input);
    case "suggest_transactions":
      return handleSuggestTransactionsTool(toolName, input, session);
    case "record_facts":
      return handleRecordFactsTool(toolName, input, session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

async function handleSearch(): Promise<ToolCallResult> {
  const types = await loadTransactionTypes();
  const activeTypes = types.filter((t) => t.status === "active");

  const summary = activeTypes.map((t) => ({
    txnTypeId: t.txnTypeId,
    name: t.name,
    summary: t.description.summary,
    keywords: t.description.keywords,
    commonPhrases: t.description.commonPhrases,
    onlineEligible: t.description.onlineEligible,
    durationMinutes: t.averageDurationMinutes,
  }));

  return { content: [{ text: JSON.stringify(summary, null, 2) }] };
}

async function handleGetDetails(txnTypeId: string): Promise<ToolCallResult> {
  const types = await loadTransactionTypes();
  const txn = types.find((t) => t.txnTypeId === txnTypeId);

  if (!txn) {
    return { content: [{ text: `Transaction type "${txnTypeId}" not found.` }] };
  }

  return {
    content: [
      {
        text: JSON.stringify(
          {
            txnTypeId: txn.txnTypeId,
            name: txn.name,
            summary: txn.description.summary,
            requiredDocuments: txn.description.requiredDocumentSummary,
            onlineEligible: txn.description.onlineEligible,
            onlineUrl: txn.description.onlineUrl || null,
            durationMinutes: txn.averageDurationMinutes,
            serviceHours: txn.serviceHours || null,
            relatedTransactionIds: txn.description.relatedTransactionIds,
            relatedPrompts: txn.description.relatedPrompts,
            notes: txn.description.notes,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleKBQuery(query: string): Promise<ToolCallResult> {
  const result = await queryKnowledgeBase(query);
  return {
    content: [
      {
        text: JSON.stringify({
          answer: result.answer,
          hasResult: result.hasResult,
          sourceCount: result.sources.length,
        }),
      },
    ],
    // Pass sources through to the response — picked up by process-message
    kbSources: result.sources,
  };
}

/**
 * When multiple transactions are bundled in one appointment, some required
 * documents are actually produced by an earlier transaction in the same visit.
 * This returns the set of document strings to suppress from "what to bring".
 *
 * Example: dl-transfer + vehicle-title-transfer
 *   dl-transfer produces a Florida driver license during the appointment,
 *   so "Valid Florida driver license or ID" should not be in "what to bring".
 */
function buildSuppressedDocs(selectedIds: Set<string>): Set<string> {
  const suppressed = new Set<string>();

  // Any DL/ID service produces a valid FL license or ID → suppress that
  // requirement from all other transactions in the bundle
  const dlProducers = [
    "dl-transfer",
    "dl-renewal",
    "dl-replacement",
    "dl-name-change",
    "real-id-upgrade",
    "id-card",
  ];
  if (dlProducers.some((id) => selectedIds.has(id))) {
    suppressed.add("Valid Florida driver license or ID");
    suppressed.add("Valid Florida driver license");
    suppressed.add("Florida driver license or ID");
  }

  // Title services produce a FL title → suppress for vehicle-registration
  // Includes duplicate-title (lost title replacement also produces a new title)
  if (
    selectedIds.has("vehicle-title-transfer") ||
    selectedIds.has("new-vehicle-title") ||
    selectedIds.has("duplicate-title")
  ) {
    suppressed.add("Florida vehicle title or pending title application");
    suppressed.add("Florida vehicle title");
  }

  // Vehicle registration produces current registration → suppress for specialty-plate
  if (selectedIds.has("vehicle-registration")) {
    suppressed.add("Current vehicle registration");
  }

  // Learner permit produces a valid permit → suppress for written-test/road-test
  // (Note: learner-permit + road-test in one visit isn't realistic due to the
  // 12-month holding requirement, but the suppression is still correct if bundled)
  if (selectedIds.has("learner-permit")) {
    suppressed.add("Valid learner permit");
    suppressed.add("Valid Florida learner's permit");
    suppressed.add("Valid learner's permit or identity documents");
  }

  return suppressed;
}

async function handleConfirm(
  transactions: Array<{ transactionTypeId: string }>,
  session: Session,
): Promise<ToolCallResult> {
  const types = await loadTransactionTypes();
  const knownIds = new Set(types.map((t) => t.txnTypeId));

  // Empty-list guardrail: refuse a confirm_selections([]) call in two cases:
  //   (a) we have stashed suggestions from suggest_transactions but no confirm
  //       has happened yet — customer's "no" was misinterpreted as "drop all".
  //   (b) there are ALREADY-active transactions on the session — calling
  //       confirm_selections([]) would silently wipe them. The dl-name-change
  //       SSA-redirect bug surfaced this: bot tells customer "go update SSA
  //       first", customer leaves, bot then calls confirm_selections([])
  //       which clears the txn list. Active txns must be preserved.
  const stashed = session.structuredContext.pendingSuggestedTxnIds ?? [];
  const hasActive = (session.structuredContext.transactions ?? []).some(
    (t) => t.status === "active" || t.status === "blocked" || t.status === "parked",
  );
  if (transactions.length === 0 && (stashed.length > 0 || hasActive)) {
    const reason = hasActive
      ? "empty-selection-with-active-txns"
      : "empty-selection-with-prior-suggestions";
    const guidance = hasActive
      ? `You called confirm_selections with NO transactions, but the customer ALREADY has confirmed transaction(s) on this session: ${session.structuredContext.transactions.map((t) => t.txnTypeId).join(", ")}. An empty confirmation would silently delete them. If the customer truly wants to abandon their existing selections, they need to say that explicitly — until then, leave the active list alone. Do NOT call confirm_selections with an empty list.`
      : `You called confirm_selections with NO transactions, but earlier you suggested ${stashed.join(", ")} from the customer's description. An empty confirmation would abandon the conversation. Either: (a) ask the customer ONE more time to pick from the suggestions; (b) if they clearly want one of the suggested services, confirm THAT service; or (c) if they truly want nothing, ask them to describe what they DO need so we can search again. Do NOT call confirm_selections with an empty list.`;
    return {
      content: [
        {
          text: JSON.stringify({
            status: "error",
            reason,
            stashedSuggestions: stashed,
            activeTxns: session.structuredContext.transactions.map((t) => t.txnTypeId),
            guidance,
          }),
        },
      ],
    };
  }

  // Refuse to silently drop unknown IDs — that masks LLM hallucinations and
  // produces an empty session that the user can't recover from.
  const unknownIds = transactions.map((t) => t.transactionTypeId).filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    return {
      content: [
        {
          text: JSON.stringify({
            status: "error",
            reason: "unknown-transactionTypeId",
            unknownIds,
            guidance:
              "One or more transactionTypeIds you submitted do not exist in the catalog. Call search_transactions or suggest_transactions to find the correct id, then retry confirm_selections. Do NOT call confirm_selections with these ids again.",
            knownIdSample: types.slice(0, 8).map((t) => t.txnTypeId),
          }),
        },
      ],
    };
  }

  const confirmed: IdentifiedTransaction[] = [];

  // Compute which documents are produced by other transactions in this bundle
  const selectedIds = new Set(transactions.map((t) => t.transactionTypeId));
  const suppressed = buildSuppressedDocs(selectedIds);

  // Update session structured context with selected transactions
  session.structuredContext.transactions = [];

  for (const { transactionTypeId } of transactions) {
    const txn = types.find((t) => t.txnTypeId === transactionTypeId);
    if (txn) {
      confirmed.push({
        txnTypeId: txn.txnTypeId,
        name: txn.name,
        durationMinutes: txn.averageDurationMinutes,
        documentSummary: txn.description.requiredDocumentSummary,
      });

      // Add to structured context as active transactions
      session.structuredContext.transactions.push({
        txnTypeId: txn.txnTypeId,
        name: txn.name,
        durationMinutes: txn.averageDurationMinutes,
        status: "active",
      });

      // Populate required documents in context (excluding suppressed ones)
      if (txn.description.requiredDocuments) {
        for (const doc of txn.description.requiredDocuments) {
          const exists = session.structuredContext.documents.some((d) => d.documentType === doc);
          if (!exists && !suppressed.has(doc)) {
            session.structuredContext.documents.push({
              documentType: doc,
              txnTypeId: txn.txnTypeId,
              status: "pending",
            });
          }
        }
      }
    }
  }

  // Deduplicate required documents across all selected transactions,
  // suppressing documents produced by another transaction in this bundle.
  const seen = new Set<string>();
  const combinedDocuments: string[] = [];
  for (const { transactionTypeId } of transactions) {
    const txn = types.find((t) => t.txnTypeId === transactionTypeId);
    if (txn?.description.requiredDocuments) {
      for (const doc of txn.description.requiredDocuments) {
        if (!seen.has(doc) && !suppressed.has(doc)) {
          seen.add(doc);
          combinedDocuments.push(doc);
        }
      }
    }
  }

  const totalDuration = confirmed.reduce((sum, t) => sum + t.durationMinutes, 0);

  // Confirm succeeded — clear the stashed suggestions so a future re-search
  // (e.g. customer mentions a NEW service later) starts fresh.
  delete session.structuredContext.pendingSuggestedTxnIds;

  // The LLM should only acknowledge what was confirmed in this state — it is
  // explicitly NOT supposed to recite the bring-in list or online channels
  // here (those belong to the side panel and later states). To make it
  // structurally impossible for the model to recite, only return the minimum
  // needed for a short confirmation. The full document list is still written
  // to session.structuredContext + returned to the conversation engine via
  // `confirmed` / `combinedDocuments` for downstream states and the UI.
  return {
    content: [
      {
        text: JSON.stringify({
          status: "confirmed",
          transactions: confirmed.map((t) => ({ txnTypeId: t.txnTypeId, name: t.name })),
          totalDurationMinutes: totalDuration,
          message: `Confirmed ${confirmed.length} transaction(s). Acknowledge briefly and stop — the eligibility-check state will run next.`,
        }),
      },
    ],
    confirmed,
    combinedDocuments,
    shouldAdvance: true,
  };
}
