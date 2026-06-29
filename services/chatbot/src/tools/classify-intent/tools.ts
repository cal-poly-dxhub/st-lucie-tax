/**
 * classify_intent tool.
 *
 * Returns a lightweight classification of the customer's latest utterance:
 *   - 'inquiry'          — general question; use query_knowledge_base, don't advance.
 *   - 'service-request'  — customer wants to do a specific transaction.
 *   - 'mixed'            — both a question and a transaction intent.
 *
 * Implementation is deliberately heuristic (keyword/regex) rather than a
 * nested LLM call: the classification is just a gate to decide whether
 * Claude should answer from KB or proceed with suggest_transactions. If
 * the heuristic is wrong, Claude still has both tools and can self-correct.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";

export const classifyIntentTools: Tool[] = [
  {
    toolSpec: {
      name: "classify_intent",
      description:
        "Classify the customer's latest message. Call this on ambiguous first turns before deciding whether to call query_knowledge_base or suggest_transactions. " +
        "Returns { intent: 'inquiry' | 'service-request' | 'mixed', confidence: 'high' | 'medium' | 'low' }.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            utterance: {
              type: "string",
              description: "The customer's latest message, verbatim.",
            },
          },
          required: ["utterance"],
        },
      },
    },
  },
];

interface ClassifyResult {
  content: ToolResultContentBlock[];
  [key: string]: unknown;
}

const INQUIRY_PATTERNS: RegExp[] = [
  /\bwhat (are|is|time|hours|are your)\b/i,
  /\bwhen (do|does|are|is) .* (open|close|hours)\b/i,
  /\bhow much (does|is|do) .* (cost|fee|charge)\b/i,
  /\bhow (do I|can I|long)\b/i,
  /\bdo you (accept|take|allow|offer)\b/i,
  /\bcan I (pay|use|bring)\b/i,
  /\bwhere (is|are|can I)\b/i,
  /\bwho (do|does|can)\b/i,
  /\bwhy\b/i,
  /\?$/,
];

const SERVICE_PATTERNS: RegExp[] = [
  /\bI need (to|a|an)\b/i,
  /\bI want (to|a|an)\b/i,
  /\bI('d| would) like (to|a|an)\b/i,
  /\b(renew|register|transfer|replace|update|upgrade|change|get|apply|book|schedule) (my|a|an|the)\b/i,
  /\bI (just )?moved\b/i,
  /\bI (just )?bought\b/i,
  /\bI got married\b/i,
  /\bmy (license|registration|tag|title|plate|permit) (is|needs|expired|expiring)\b/i,
  /\bappointment\b/i,
  /\bCDL\b/,
  /\breal id\b/i,
];

export function handleClassifyIntentTool(
  toolName: string,
  input: Record<string, unknown>,
): ClassifyResult {
  if (toolName !== "classify_intent") {
    return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }

  const utterance = String(input.utterance ?? "").trim();
  if (!utterance) {
    return {
      content: [
        {
          text: JSON.stringify({ intent: "inquiry", confidence: "low", reason: "empty utterance" }),
        },
      ],
    };
  }

  const inquiryMatches = INQUIRY_PATTERNS.filter((p) => p.test(utterance)).length;
  const serviceMatches = SERVICE_PATTERNS.filter((p) => p.test(utterance)).length;

  let intent: "inquiry" | "service-request" | "mixed";
  let confidence: "high" | "medium" | "low";

  if (inquiryMatches > 0 && serviceMatches > 0) {
    intent = "mixed";
    confidence = "medium";
  } else if (inquiryMatches > serviceMatches) {
    intent = "inquiry";
    confidence = inquiryMatches >= 2 ? "high" : "medium";
  } else if (serviceMatches > 0) {
    intent = "service-request";
    confidence = serviceMatches >= 2 ? "high" : "medium";
  } else {
    intent = "service-request";
    confidence = "low";
  }

  return {
    content: [
      {
        text: JSON.stringify({
          intent,
          confidence,
          signals: { inquiryMatches, serviceMatches },
        }),
      },
    ],
  };
}
