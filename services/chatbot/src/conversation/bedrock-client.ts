/**
 * Bedrock Converse API client with per-state tool use.
 * Ported from prototype bedrock.ts, generalized for state machine.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message,
  type ContentBlock,
  type ToolUseBlock,
  type Tool,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { appendLog } from "./debug-log.js";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 10;

// Intermittently (~0.05% of turns, observed across a month of beta) the model
// "types out" a tool call as literal XML text instead of emitting a structured
// toolUse block — e.g. `<invoke name="record_facts"><parameter name="facts">[…]
// </parameter></invoke>`. Bedrock still reports stopReason='tool_use', but the
// content is a text block, so the normal tool path is skipped: the markup leaks
// to the customer AND the intended tool never runs (so the fact is dropped and
// the question gets re-asked). These guards detect, salvage, and scrub it.
const LEAKED_TOOLCALL_RE = /<invoke\b|<\/invoke>|<parameter\b|<function_calls>/i;

// Strip any leaked tool-call markup from customer-facing text. Removes whole
// <invoke>…</invoke> / <function_calls>…</function_calls> blocks and any stray
// <invoke>/<parameter> tags, so internal markup can never reach the customer.
export function stripToolCallMarkup(text: string): string {
  return (
    text
      .replace(/<function_calls>[\s\S]*?<\/(?:antml:)?function_calls>/gi, "")
      .replace(/<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/gi, "")
      // Unclosed/partial leaks: drop from the first stray tag to end of string.
      .replace(/<(?:antml:)?(?:invoke|parameter|function_calls)\b[\s\S]*$/i, "")
      .replace(/<\/(?:antml:)?(?:invoke|parameter|function_calls)>/gi, "")
      .trim()
  );
}

// Best-effort salvage: pull a record_facts payload out of leaked tool-call XML
// so we can execute it directly (avoiding a dropped fact + re-asked question).
// The leaked shape is consistent: <parameter name="facts">[ …JSON… ]</parameter>.
// Returns the parsed { facts: [...] } input, or null if it can't be recovered.
export function parseLeakedRecordFacts(text: string): { facts: unknown[] } | null {
  if (!/name=["']record_facts["']/i.test(text)) return null;
  const m = text.match(/<parameter\s+name=["']facts["']\s*>\s*([\s\S]*?)\s*<\/parameter>/i);
  if (!m) return null;
  try {
    const facts = JSON.parse(m[1]);
    if (Array.isArray(facts) && facts.length > 0) return { facts };
  } catch {
    // unrecoverable — caller falls back to the corrective retry
  }
  return null;
}

const LEAKED_TOOLCALL_CORRECTION =
  "Your previous reply contained a tool call written as literal text (e.g. <invoke> / <parameter> tags), which is invalid and is NOT executed. Never write tool-call markup as text. If you meant to record a fact, call the record_facts tool through the proper tool interface. Otherwise, reply to the customer in plain language with the next question.";

const LEAKED_TOOLCALL_FALLBACK = "Thanks — let me pull up your next question.";

// Bedrock returns ThrottlingException/ServiceUnavailableException during bursts;
// retry transparently with exponential backoff. Tuned to absorb 4-8× concurrent
// eval pressure: 7 attempts, 500ms→32s exponential, total ~62s worst-case.
const RETRYABLE_ERROR_NAMES = new Set([
  "ThrottlingException",
  "ServiceUnavailableException",
  "ModelTimeoutException",
  "ModelStreamErrorException",
  "InternalServerException",
  "TooManyRequestsException",
]);
const MAX_BEDROCK_ATTEMPTS = 7;

async function sendWithRetry(cmd: ConverseCommand): Promise<ConverseCommandOutput> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < MAX_BEDROCK_ATTEMPTS) {
    try {
      return await client.send(cmd);
    } catch (err) {
      lastErr = err;
      const name = (err as { name?: string } | undefined)?.name ?? "";
      if (!RETRYABLE_ERROR_NAMES.has(name)) throw err;
      attempt += 1;
      if (attempt >= MAX_BEDROCK_ATTEMPTS) break;
      // Exponential backoff with jitter: 500ms, 1s, 2s, 4s, 8s, 16s, 32s
      const delayMs = 500 * Math.pow(2, attempt - 1) + Math.random() * 250;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export interface LogContext {
  tenantId: string;
  sessionId: string;
}

export interface ToolHandler {
  (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{
    content: ToolResultContentBlock[];
    shouldAdvance?: boolean;
    [key: string]: unknown;
  }>;
}

export interface KBSource {
  title: string;
  url?: string;
  type: "page" | "pdf";
}

export interface ConversationResult {
  assistantMessage: string;
  toolResults: Record<string, unknown>;
  shouldAdvance: boolean;
  updatedMessages: Message[];
  kbSources: KBSource[];
}

export async function callBedrock(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[],
  toolHandler: ToolHandler,
  logCtx?: LogContext,
): Promise<ConversationResult> {
  const workingMessages = [...messages];
  let lastAssistantText = "";
  let shouldAdvance = false;
  const allToolResults: Record<string, unknown> = {};
  const collectedKbSources: KBSource[] = [];
  // Bounded self-heal: only attempt the leaked-tool-call recovery once per
  // call, so a persistently-misbehaving model can't loop (MAX_TOOL_ROUNDS is
  // the hard backstop).
  let leakedRetryUsed = false;

  const log = (eventType: string, payload: unknown) => {
    if (!logCtx) return;
    // Fire-and-forget; appendLog catches its own errors.
    void appendLog(logCtx.tenantId, logCtx.sessionId, eventType, payload);
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    log("bedrock.converse.request", {
      round,
      modelId: MODEL_ID,
      systemPrompt,
      messages: workingMessages,
      toolNames: tools.map((t) => t.toolSpec?.name).filter(Boolean),
    });

    const response = await sendWithRetry(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }],
        messages: workingMessages,
        ...(tools.length > 0 && { toolConfig: { tools } }),
        inferenceConfig: {
          maxTokens: 2048,
          temperature: 0.3,
        },
      }),
    );

    const stopReason = response.stopReason;
    const outputContent = response.output?.message?.content || [];

    log("bedrock.converse.response", {
      round,
      stopReason,
      output: outputContent,
      tokenUsage: response.usage ?? null,
    });

    // Extract text and tool use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: ToolUseBlock[] = [];

    for (const block of outputContent) {
      if ("text" in block && block.text) {
        textBlocks.push(block.text);
      }
      if ("toolUse" in block && block.toolUse) {
        toolUseBlocks.push(block.toolUse as ToolUseBlock);
      }
    }

    if (textBlocks.length > 0) {
      lastAssistantText = textBlocks.join("\n");
    }

    // Add assistant message to working history
    workingMessages.push({
      role: "assistant",
      content: outputContent as ContentBlock[],
    });

    // Self-heal a malformed tool turn: the model emitted a tool call as literal
    // XML text instead of a structured toolUse block (stopReason is 'tool_use'
    // but there are no toolUse blocks, and the text looks like tool-call markup).
    // Salvage a record_facts payload if we can, then push a corrective turn and
    // retry so the conversation continues cleanly. Bounded to once per call.
    const looksLikeLeakedToolCall =
      toolUseBlocks.length === 0 &&
      textBlocks.length > 0 &&
      LEAKED_TOOLCALL_RE.test(lastAssistantText);
    if (looksLikeLeakedToolCall && !leakedRetryUsed) {
      leakedRetryUsed = true;
      log("bedrock.toolcall.leaked", { round, leakedText: lastAssistantText.slice(0, 1000) });

      // Best-effort salvage: if the leak was a record_facts call we can parse,
      // execute it directly so the fact records and the bot doesn't re-ask.
      const salvaged = parseLeakedRecordFacts(lastAssistantText);
      if (salvaged) {
        try {
          const result = await toolHandler("record_facts", salvaged as Record<string, unknown>);
          log("bedrock.toolcall.salvaged", {
            name: "record_facts",
            input: salvaged,
            ok: true,
          });
          if (result.shouldAdvance) shouldAdvance = true;
          if (result.kbSources && Array.isArray(result.kbSources)) {
            collectedKbSources.push(...(result.kbSources as KBSource[]));
          }
        } catch (err) {
          log("bedrock.toolcall.salvaged", { name: "record_facts", ok: false, error: String(err) });
        }
      }

      // Don't let the leaked markup become the customer-facing reply.
      lastAssistantText = "";
      // Push a corrective user turn and retry the round.
      workingMessages.push({
        role: "user",
        content: [{ text: LEAKED_TOOLCALL_CORRECTION }],
      });
      continue;
    }

    // Handle tool use
    if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
      const toolResults: ContentBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name!;
        const toolInput = toolUse.input as Record<string, unknown>;
        log("tool.invoke", { name: toolName, input: toolInput });

        const result = await toolHandler(toolName, toolInput);

        const extraKeys = Object.keys(result).filter(
          (k) => k !== "content" && k !== "shouldAdvance" && k !== "kbSources",
        );
        const contentPreview = Array.isArray(result.content)
          ? result.content
              .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
              .filter(Boolean)
              .join("\n")
              .slice(0, 2000)
          : "";
        log("tool.result", {
          name: toolName,
          shouldAdvance: !!result.shouldAdvance,
          kbSourceCount: Array.isArray(result.kbSources) ? result.kbSources.length : 0,
          contentPreview,
          extraKeys,
        });

        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId!,
            content: result.content,
          },
        } as ContentBlock);

        if (result.shouldAdvance) {
          shouldAdvance = true;
        }

        // Collect KB sources if present
        if (result.kbSources && Array.isArray(result.kbSources)) {
          collectedKbSources.push(...(result.kbSources as KBSource[]));
        }

        // Collect any extra result data
        for (const [key, value] of Object.entries(result)) {
          if (key !== "content" && key !== "shouldAdvance" && key !== "kbSources") {
            allToolResults[key] = value;
          }
        }
      }

      workingMessages.push({
        role: "user",
        content: toolResults,
      });

      continue;
    }

    // end_turn — done
    break;
  }

  // Belt-and-suspenders: never let leaked tool-call markup reach the customer,
  // even if a self-heal retry round still produced stray tags. Scrub the final
  // text; if scrubbing empties it, use a safe generic line.
  if (LEAKED_TOOLCALL_RE.test(lastAssistantText)) {
    const scrubbed = stripToolCallMarkup(lastAssistantText);
    lastAssistantText = scrubbed.length > 0 ? scrubbed : LEAKED_TOOLCALL_FALLBACK;
  }

  return {
    assistantMessage: lastAssistantText,
    toolResults: allToolResults,
    shouldAdvance,
    updatedMessages: workingMessages,
    kbSources: collectedKbSources,
  };
}
