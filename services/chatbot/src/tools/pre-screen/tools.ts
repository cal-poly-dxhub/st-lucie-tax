/**
 * Tools for the pre-screen state.
 *
 * Key behaviors:
 * - Load questions for ALL transaction types, dedup by questionKey
 * - Evaluate blockingRule on each answer
 * - Exception resolution loop for blocked transactions
 * - Per-transaction status: active / dropped / blocked / parked / escalated
 * - Zero active transactions → end session
 * - Recalculate duration from active only
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session, PreScreeningQuestion } from "@st-lucie/shared-types";
import { queryGlobalByPrefix } from "@st-lucie/data-access";
import { queryKnowledgeBase } from "../../knowledge-base/query.js";
import { getDecisionTree } from "../../data-loaders/decision-trees.js";

export const preScreenTools: Tool[] = [
  {
    toolSpec: {
      name: "load_prescreening_questions",
      description:
        "Load all pre-screening questions for the customer's active transactions. Questions are deduplicated by questionKey — shared questions appear once.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "record_answer",
      description:
        "Record the customer's answer to a pre-screening question. Evaluates blocking rules automatically.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            questionKey: { type: "string", description: "The question key" },
            answer: { type: "string", description: "The customer's answer" },
          },
          required: ["questionKey", "answer"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "resolve_blocked_transaction",
      description:
        'Resolve a blocked transaction. Options: "resolved" (issue fixed), "dropped" (customer removes it), "blocked" (book anyway, resolve with clerk).',
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            txnTypeId: { type: "string", description: "Transaction type to resolve" },
            resolution: {
              type: "string",
              description: 'Resolution: "resolved", "dropped", or "blocked"',
            },
            reason: { type: "string", description: "Reason or notes for the resolution" },
          },
          required: ["txnTypeId", "resolution"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "query_knowledge_base",
      description:
        "Search the St. Lucie County Tax Collector knowledge base for guidance when a pre-screening answer triggers a blocking condition. Use this to find county-specific information like where to obtain a document, how to resolve an issue, or what alternatives exist.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description:
                'What to search for (e.g., "how to obtain a lien release letter in St. Lucie County")',
            },
          },
          required: ["query"],
        },
      },
    },
  },
  // skip_prescreening removed — pre-screening is mandatory per business rules
  {
    toolSpec: {
      name: "complete_prescreening",
      description:
        "Mark pre-screening as complete and advance to checkout check. Call when all questions are answered.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
];

export interface PreScreenToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export async function handlePreScreenTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<PreScreenToolResult> {
  switch (toolName) {
    case "load_prescreening_questions":
      return handleLoadQuestions(session);
    case "record_answer":
      return handleRecordAnswer(input as { questionKey: string; answer: string }, session);
    case "resolve_blocked_transaction":
      return handleResolveBlocked(
        input as { txnTypeId: string; resolution: string; reason?: string },
        session,
      );
    case "query_knowledge_base":
      return handleKBQuery(input as { query: string });
    case "complete_prescreening":
      return handleComplete(session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

async function handleLoadQuestions(session: Session): Promise<PreScreenToolResult> {
  // Transactions covered by a decision tree are already fact-resolved in the
  // resolve-facts state. Only fall back to the legacy hand-authored question
  // path for transactions that do NOT yet have a tree.
  const activeTypes = session.structuredContext.transactions
    .filter((t) => t.status === "active" && !getDecisionTree(t.txnTypeId))
    .map((t) => t.txnTypeId);

  // Load questions for all active transaction types from DynamoDB
  const allQuestions: PreScreeningQuestion[] = [];
  for (const txnTypeId of activeTypes) {
    const items = await queryGlobalByPrefix("PRESCREENING", txnTypeId, "Q#");
    for (const item of items) {
      allQuestions.push({
        questionKey: item.questionKey as string,
        questionText: item.questionText as string,
        answerType: item.answerType as string as PreScreeningQuestion["answerType"],
        blockingRule: item.blockingRule as string | undefined,
        blockingMessage: item.blockingMessage as string | undefined,
        txnTypeId: item.txnTypeId as string,
        sequence: item.sequence as number,
      });
    }
  }

  // Deduplicate by questionKey.
  // Shared questions asked once, answer applied to all transaction types
  const dedupMap = new Map<
    string,
    {
      question: PreScreeningQuestion;
      appliesTo: string[];
    }
  >();

  for (const q of allQuestions) {
    const existing = dedupMap.get(q.questionKey);
    if (existing) {
      existing.appliesTo.push(q.txnTypeId);
      // Keep the stricter blocking rule if both have one
      if (q.blockingRule && !existing.question.blockingRule) {
        existing.question.blockingRule = q.blockingRule;
        existing.question.blockingMessage = q.blockingMessage;
      }
    } else {
      dedupMap.set(q.questionKey, {
        question: q,
        appliesTo: [q.txnTypeId],
      });
    }
  }

  // Filter out already-answered questions
  const answered = session.structuredContext.preScreening.answers;
  const unanswered = Array.from(dedupMap.entries())
    .filter(([key]) => !answered[key])
    .map(([key, { question, appliesTo }]) => ({
      questionKey: key,
      questionText: question.questionText,
      answerType: question.answerType,
      hasBlockingRule: !!question.blockingRule,
      appliesTo,
    }));

  return {
    content: [
      {
        text: JSON.stringify({
          totalQuestions: dedupMap.size,
          answered: Object.keys(answered).length,
          remaining: unanswered.length,
          questions: unanswered,
          note:
            unanswered.length === 0
              ? "All questions answered. Call complete_prescreening to proceed."
              : "Ask these questions conversationally. Record each answer with record_answer.",
        }),
      },
    ],
  };
}

async function handleRecordAnswer(
  input: { questionKey: string; answer: string },
  session: Session,
): Promise<PreScreenToolResult> {
  const { questionKey, answer } = input;

  // Find which transaction types this question applies to
  const activeTypes = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .map((t) => t.txnTypeId);

  // Load the question to check blocking rules
  let blockingRule: string | undefined;
  let blockingMessage: string | undefined;
  const appliedTo: string[] = [];

  for (const txnTypeId of activeTypes) {
    const items = await queryGlobalByPrefix("PRESCREENING", txnTypeId, "Q#");
    for (const item of items) {
      if (item.questionKey === questionKey) {
        appliedTo.push(txnTypeId);
        if (item.blockingRule) {
          blockingRule = item.blockingRule as string;
          blockingMessage = item.blockingMessage as string;
        }
      }
    }
  }

  // Evaluate blocking rule.
  let blocked = false;
  if (blockingRule) {
    try {
      // Safe evaluation of simple rules like: answer === "no"
      blocked = evaluateBlockingRule(blockingRule, answer);
    } catch {
      // If rule evaluation fails, don't block
    }
  }

  // Record the answer
  session.structuredContext.preScreening.answers[questionKey] = {
    questionKey,
    answer,
    blocked,
    appliedToTxnTypes: appliedTo,
    resolutionStatus: blocked ? undefined : "resolved",
  };

  if (blocked) {
    // Mark affected transactions as needing resolution
    const blockedTxns = appliedTo.map(
      (id) => session.structuredContext.transactions.find((t) => t.txnTypeId === id)?.name || id,
    );

    return {
      content: [
        {
          text: JSON.stringify({
            status: "blocked",
            questionKey,
            answer,
            blockedTransactions: appliedTo,
            blockedTransactionNames: blockedTxns,
            blockingMessage:
              blockingMessage || "This answer may prevent completing the transaction.",
            instruction: `The customer's answer blocks: ${blockedTxns.join(", ")}. ${blockingMessage} Help the customer resolve the issue, or ask if they want to drop the transaction or proceed anyway (resolve with clerk at the office). Use resolve_blocked_transaction when decided.`,
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        text: JSON.stringify({
          status: "recorded",
          questionKey,
          answer,
          appliedTo,
        }),
      },
    ],
  };
}

/**
 * Evaluate blocking rules with fuzzy natural-language matching.
 * The LLM sends normalized answers, but customers might say things like
 * "no I don't have that" or "yeah I do" which need interpretation.
 */
function evaluateBlockingRule(rule: string, answer: string): boolean {
  const normalizedAnswer = answer.toLowerCase().trim();
  const normalizedRule = rule.toLowerCase().trim();

  const NEGATIVE_PATTERNS = [
    "no",
    "n",
    "nope",
    "i don't",
    "i dont",
    "don't have",
    "dont have",
    "not yet",
    "no i",
    "i haven't",
    "i havent",
    "negative",
    "unfortunately no",
    "i can't",
    "i cant",
    "i do not",
    "not at this time",
  ];

  const POSITIVE_PATTERNS = [
    "yes",
    "y",
    "yeah",
    "yep",
    "yup",
    "i do",
    "i have",
    "got it",
    "i can",
    "sure",
    "absolutely",
    "affirmative",
    "of course",
  ];

  if (normalizedRule === 'answer === "no"' || normalizedRule === "answer === 'no'") {
    return NEGATIVE_PATTERNS.some((p) => normalizedAnswer.startsWith(p) || normalizedAnswer === p);
  }
  if (normalizedRule === 'answer === "yes"' || normalizedRule === "answer === 'yes'") {
    return POSITIVE_PATTERNS.some((p) => normalizedAnswer.startsWith(p) || normalizedAnswer === p);
  }

  return false;
}

async function handleKBQuery(input: { query: string }): Promise<PreScreenToolResult> {
  const result = await queryKnowledgeBase(input.query);
  return {
    content: [
      {
        text: JSON.stringify({
          answer: result.answer,
          hasResult: result.hasResult,
          sources: result.sources.map((s) => ({ title: s.title, url: s.url })),
        }),
      },
    ],
    kbSources: result.sources,
  };
}

async function handleResolveBlocked(
  input: { txnTypeId: string; resolution: string; reason?: string },
  session: Session,
): Promise<PreScreenToolResult> {
  const { txnTypeId, resolution, reason } = input;

  const txn = session.structuredContext.transactions.find((t) => t.txnTypeId === txnTypeId);
  if (!txn) {
    return { content: [{ text: `Transaction ${txnTypeId} not found` }] };
  }

  switch (resolution) {
    case "resolved":
      txn.status = "active";
      break;
    case "dropped":
      txn.status = "dropped";
      txn.blockedReason = reason || "Dropped by customer during pre-screening";
      break;
    case "blocked":
      txn.status = "blocked";
      txn.blockedReason = reason || "To be resolved with clerk at office";
      break;
    default:
      return { content: [{ text: `Invalid resolution: ${resolution}` }] };
  }

  // Update any related pre-screening answers
  for (const ans of Object.values(session.structuredContext.preScreening.answers)) {
    if (ans.blocked && ans.appliedToTxnTypes.includes(txnTypeId)) {
      ans.resolutionStatus = resolution as "resolved" | "dropped" | "parked" | "escalated";
    }
  }

  // Zero active transactions → inform the chatbot.
  const activeCount = session.structuredContext.transactions.filter(
    (t) => t.status === "active",
  ).length;

  // Recalculate duration from active only.
  const totalDuration = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .reduce((sum, t) => sum + t.durationMinutes, 0);

  return {
    content: [
      {
        text: JSON.stringify({
          status: "resolved",
          txnTypeId,
          resolution,
          activeTransactionCount: activeCount,
          totalDurationMinutes: totalDuration,
          note:
            activeCount === 0
              ? "All transactions have been dropped or blocked. The session should end."
              : `${activeCount} active transaction(s) remaining. Total duration: ${totalDuration} minutes.`,
        }),
      },
    ],
    // If zero active, don't advance — the bot should handle ending the session
  };
}

function handleComplete(session: Session): PreScreenToolResult {
  // Mark completed transaction types
  const activeTypes = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .map((t) => t.txnTypeId);
  session.structuredContext.preScreening.completedTxnTypes = activeTypes;

  // Final duration calculation from active only.
  const totalDuration = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .reduce((sum, t) => sum + t.durationMinutes, 0);

  return {
    content: [
      {
        text: JSON.stringify({
          status: "complete",
          activeTransactions: activeTypes.length,
          totalDurationMinutes: totalDuration,
          message: "Pre-screening complete. Moving to checkout eligibility check.",
        }),
      },
    ],
    shouldAdvance: true,
  };
}
