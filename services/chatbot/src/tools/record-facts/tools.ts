/**
 * record_facts tool.
 *
 * Callable from any conversation state. Claude invokes this opportunistically
 * whenever the customer reveals information that matches a known fact key
 * (citizenship, military status, license state, etc.).
 *
 * The tool validates every submitted fact against fact-definitions.json:
 * unknown factKey → rejected; value not in allowedValues → rejected.
 * Valid facts are merged into `session.structuredContext.facts` with
 * `{value, confidence, source: 'user-message', updatedAt}` and persisted
 * via updateSession.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session, FactConfidence, FactSource, FactValue } from "@st-lucie/shared-types";
import { loadFactDefinitions, getFactDefinition } from "../../data-loaders/fact-definitions.js";
import { loadFactImplications } from "../../data-loaders/fact-implications.js";
import { updateSession } from "../../session/update-session.js";

const VALID_CONFIDENCES: FactConfidence[] = ["asserted", "inferred", "unknown"];
const VALID_SOURCES: FactSource[] = ["user-message", "prescreening", "ocr", "inference"];

export const recordFactsTools: Tool[] = [
  {
    toolSpec: {
      name: "record_facts",
      description: buildRecordFactsDescription(),
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            facts: {
              type: "array",
              description: "One or more facts to record.",
              items: {
                type: "object",
                properties: {
                  factKey: {
                    type: "string",
                    description:
                      'Key from fact-definitions.json (e.g., "is_us_citizen", "cdl_expiration_range").',
                  },
                  value: {
                    type: "string",
                    description: "One of the allowedValues for the given factKey.",
                  },
                  confidence: {
                    type: "string",
                    enum: VALID_CONFIDENCES,
                    description:
                      "asserted = user stated it directly; inferred = you deduced it; unknown = uncertain.",
                  },
                  source: {
                    type: "string",
                    enum: VALID_SOURCES,
                    description: "Where the fact came from. Default: user-message.",
                  },
                },
                required: ["factKey", "value", "confidence"],
              },
            },
          },
          required: ["facts"],
        },
      },
    },
  },
];

interface FactInput {
  factKey: string;
  value: string;
  confidence: FactConfidence;
  source?: FactSource;
}

interface RecordResult {
  content: ToolResultContentBlock[];
  [key: string]: unknown;
}

export async function handleRecordFactsTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<RecordResult> {
  if (toolName !== "record_facts") {
    return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }

  const rawFacts = input.facts as FactInput[] | undefined;
  if (!Array.isArray(rawFacts) || rawFacts.length === 0) {
    return {
      content: [{ text: JSON.stringify({ status: "error", message: "No facts provided." }) }],
    };
  }

  const recorded: Array<{ factKey: string; value: string; confidence: FactConfidence }> = [];
  const rejected: Array<{ factKey: string; value: string; reason: string }> = [];

  const now = new Date().toISOString();

  for (const fact of rawFacts) {
    const def = getFactDefinition(fact.factKey);
    if (!def) {
      rejected.push({
        factKey: fact.factKey,
        value: fact.value,
        reason: `Unknown factKey "${fact.factKey}". Not in fact-definitions.json.`,
      });
      continue;
    }
    const normalized = normalizeFactValue(fact.value, def.allowedValues);
    if (normalized === null) {
      rejected.push({
        factKey: fact.factKey,
        value: fact.value,
        reason: `Value "${fact.value}" not allowed. allowedValues: ${def.allowedValues.join(", ")}`,
      });
      continue;
    }
    fact.value = normalized;
    if (!VALID_CONFIDENCES.includes(fact.confidence)) {
      rejected.push({
        factKey: fact.factKey,
        value: fact.value,
        reason: `Invalid confidence "${fact.confidence}". Must be one of: ${VALID_CONFIDENCES.join(", ")}`,
      });
      continue;
    }

    const source: FactSource =
      fact.source && VALID_SOURCES.includes(fact.source) ? fact.source : "user-message";

    const factValue: FactValue = {
      value: fact.value,
      confidence: fact.confidence,
      source,
      updatedAt: now,
    };

    session.structuredContext.facts[fact.factKey] = factValue;
    recorded.push({ factKey: fact.factKey, value: fact.value, confidence: fact.confidence });
  }

  // Cascade deterministic implications — e.g. cdl_origin=fl-original-first-time
  // implies cdl_expiration_range=never-held. Applied after the user's facts
  // are in place so we can match against the full post-write state.
  const implied = applyImplications(session, now);

  if (recorded.length > 0 || implied.length > 0) {
    await updateSession(session);
  }

  return {
    content: [
      {
        text: JSON.stringify({
          status: rejected.length === 0 ? "ok" : "partial",
          recorded,
          rejected,
          implied,
          totalFactsKnown: Object.keys(session.structuredContext.facts).length,
        }),
      },
    ],
  };
}

/**
 * Normalize an LLM-provided value against the fact's allowedValues.
 *
 * Returns the canonical allowedValue if a match is found, else null.
 *
 * Handles three classes of LLM drift:
 *   1. Casing / whitespace ("Yes" → "yes", " no " → "no")
 *   2. Numeric synonyms ("0" → "zero", "1" → "one", "2" → "two-or-more")
 *   3. Common synonym map ("none" → "no" or "zero" depending on which is allowed)
 */
function normalizeFactValue(raw: string, allowedValues: string[]): string | null {
  if (typeof raw !== "string") return null;
  // Direct hit (most common case)
  if (allowedValues.includes(raw)) return raw;

  const trimmed = raw.trim();
  if (allowedValues.includes(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  if (allowedValues.includes(lower)) return lower;

  // Synonym map — applied only if the canonical target is in allowedValues.
  const synonyms: Record<string, string[]> = {
    zero: ["0", "none", "no bills", "nothing", "nada"],
    one: ["1", "just one"],
    "two-or-more": ["2", "3", "4", "two", "three", "two or more", "multiple"],
    no: ["none", "nope", "nah", "negative"],
    yes: ["yep", "yeah", "yup", "affirmative", "correct"],
    unknown: ["not sure", "idk", "i don't know", "dunno", "maybe"],
  };
  for (const [canonical, alts] of Object.entries(synonyms)) {
    if (!allowedValues.includes(canonical)) continue;
    if (alts.includes(lower)) return canonical;
  }
  return null;
}

/**
 * Apply every matching rule from fact-implications.json. A rule fires when all
 * `when` facts are present (any confidence except `unknown`) and match. Each
 * implied fact is only written if not already present — we never overwrite an
 * existing asserted value. Iterates until a fixed point so cascades compose.
 */
function applyImplications(
  session: Session,
  now: string,
): Array<{ factKey: string; value: string; reason: string }> {
  const rules = loadFactImplications();
  const facts = session.structuredContext.facts;
  const added: Array<{ factKey: string; value: string; reason: string }> = [];

  let changed = true;
  let passes = 0;
  while (changed && passes < 10) {
    changed = false;
    passes += 1;
    for (const rule of rules) {
      const matches = Object.entries(rule.when).every(([key, expected]) => {
        const fv = facts[key];
        return !!fv && fv.confidence !== "unknown" && fv.value === expected;
      });
      if (!matches) continue;
      for (const [key, value] of Object.entries(rule.then)) {
        if (facts[key]) continue; // don't overwrite existing facts
        facts[key] = {
          value,
          confidence: "inferred",
          source: "inference",
          updatedAt: now,
        };
        added.push({
          factKey: key,
          value,
          reason: rule.note ?? `Implied from ${JSON.stringify(rule.when)}`,
        });
        changed = true;
      }
    }
  }
  return added;
}

/**
 * Build a tool description that lists every known factKey and its allowedValues.
 * Included in the toolSpec so Claude has the full catalogue available without
 * needing a separate list-facts tool call.
 */
function buildRecordFactsDescription(): string {
  const defs = loadFactDefinitions();
  const lines: string[] = [
    "Record one or more facts about the customer derived from the conversation.",
    "Use opportunistically — any time the customer reveals information that maps to a known factKey, call this tool.",
    "Do NOT invent facts the customer has not stated. Only record what is supported by their messages or confirmed inference.",
    "",
    "Known facts (factKey → allowedValues):",
  ];
  for (const d of defs) {
    lines.push(`- ${d.factKey} (${d.scope}): ${d.allowedValues.join(" | ")}. ${d.label}.`);
  }
  return lines.join("\n");
}
