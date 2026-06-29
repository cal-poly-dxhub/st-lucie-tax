/**
 * Core message processor.
 *
 * Orchestrates: load session -> determine state -> load prompt -> build memory ->
 * call Bedrock with state tools -> handle results -> advance state if needed ->
 * persist session + raw history
 */

import { randomUUID } from "node:crypto";
import type { Session, ProcessMessageResponse } from "@st-lucie/shared-types";
import { getSession } from "../session/get-session.js";
import { updateSession } from "../session/update-session.js";
import { buildSystemPrompt } from "../prompts/prompt-loader.js";
import { buildBedrockMessages, addUserTurn, addAssistantTurn } from "./memory.js";
import { appendRawHistory } from "./raw-history.js";
import { callBedrock } from "./bedrock-client.js";
import { appendLog } from "./debug-log.js";
import { advanceState, shouldAutoAdvance } from "../state-machine/transitions.js";
import { isTerminal, getStateMetadata } from "../state-machine/states.js";
import { getStateTools, getStateToolHandler } from "./state-tools.js";
import { scrubSensitiveInput, scrubNoticeForPrompt } from "../middleware/input-scrub.js";

export async function processMessage(
  tenantId: string,
  sessionId: string,
  message: string,
): Promise<ProcessMessageResponse> {
  // Load session
  const session = await getSession(tenantId, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // SEC-06: strip sensitive numbers (SSN / payment-card / bank) the user should
  // never need to type here, BEFORE the message is logged, persisted to
  // history, or sent to the model. Engine-useful numbers (DL, dates, money,
  // ZIP, phone, durations) are preserved — see middleware/input-scrub.ts.
  // From here on, `message` is the scrubbed text; `scrubNotice` (if any) is
  // threaded into the system prompt so the bot reassures rather than re-asks.
  const scrub = scrubSensitiveInput(message);
  message = scrub.clean;
  const scrubNotice = scrubNoticeForPrompt(scrub.removed);
  if (scrub.removed.length > 0) {
    void appendLog(tenantId, sessionId, "input.scrubbed", { kinds: scrub.removed });
  }

  // Snapshot the state we entered this turn in. autoGreet only fires when
  // the state CHANGED during this turn — if we're already in (e.g.)
  // universal-blockers from a prior turn, the regular Bedrock round handles
  // it and we don't need a second pass.
  const stateAtEntry = session.currentState;

  void appendLog(tenantId, sessionId, "message.received", {
    userMessage: message,
    currentState: session.currentState,
  });

  // Handle landing state — auto-advance to identify-transaction on first message
  if (session.currentState === "landing") {
    const from = session.currentState;
    advanceState(session);
    void appendLog(tenantId, sessionId, "state.advance", {
      from,
      to: session.currentState,
      reason: "landing-auto",
    });
  }

  // Add user turn to current state's conversation
  addUserTurn(session, message);

  // Persist raw history (3-year retention, no TTL)
  await appendRawHistory(tenantId, sessionId, "user", message);

  // Loop guard: if the bot has asked the same question 2+ times in a row in this
  // state, it's stuck. Inject a system note so the LLM knows to escalate or
  // change tack rather than re-asking. Detected by comparing the first
  // sentence of the last 3 assistant turns within the current state.
  const stuckOnQuestion = detectQuestionLoop(session);

  // Build system prompt (state-specific + structured context)
  const systemPrompt = await buildSystemPrompt(session, { stuckOnQuestion, scrubNotice });

  // Build Bedrock messages from current state's turns only
  const bedrockMessages = buildBedrockMessages(session);

  // Get state-specific tools and handler
  const tools = getStateTools(session.currentState, session);
  const toolHandler = getStateToolHandler(session.currentState, session);

  // Call Bedrock
  const result = await callBedrock(systemPrompt, bedrockMessages, tools, toolHandler, {
    tenantId,
    sessionId,
  });

  // Add assistant response to current state's turns
  addAssistantTurn(session, result.assistantMessage);

  // One server-assigned id per visible assistant reply. The client uses it as
  // the feedback key; the HISTORY row carries the same id so the admin can join
  // per-message feedback inline. The autoGreet continuation (below) is folded
  // into the SAME visible bubble, so it intentionally reuses this id rather
  // than minting a second one.
  const assistantMessageId = randomUUID();

  // Persist raw history for assistant response
  await appendRawHistory(
    tenantId,
    sessionId,
    "assistant",
    result.assistantMessage,
    undefined,
    assistantMessageId,
  );

  // Advance state if tools indicated we should
  if (result.shouldAdvance) {
    const from = session.currentState;
    advanceState(session);
    void appendLog(tenantId, sessionId, "state.advance", {
      from,
      to: session.currentState,
      reason: "tool",
    });
  }

  // Cascade through any states whose entry conditions are already satisfied
  // (e.g. upload-docs with nothing uploadable, pre-screen already covered by
  // resolve-facts). Bounded to prevent accidental infinite loops.
  let cascadeSteps = 0;
  while (!isTerminal(session.currentState) && shouldAutoAdvance(session) && cascadeSteps < 10) {
    const from = session.currentState;
    advanceState(session);
    void appendLog(tenantId, sessionId, "state.advance", {
      from,
      to: session.currentState,
      reason: "cascade",
    });
    cascadeSteps += 1;
  }

  // Auto-greet pass: if we landed in a state flagged `autoGreet`, immediately
  // run a second Bedrock round under THAT state's prompt before returning
  // to the user. The two assistant messages are concatenated so the customer
  // sees one coherent reply (e.g. "Service confirmed. Quick eligibility check
  // — first, is your license suspended?") instead of having to send a dummy
  // turn to advance the conversation.
  let combinedMessage = result.assistantMessage;
  let autoGreetRan = false;
  // autoGreet fires on any state flagged for it — including terminal states
  // like `schedule` that still need to open their widget on entry. Other
  // terminal states (e.g. `confirm`) carry no autoGreet flag, so stay silent.
  if (session.currentState !== stateAtEntry && getStateMetadata(session.currentState).autoGreet) {
    autoGreetRan = true;
    void appendLog(tenantId, sessionId, "auto-greet.start", {
      state: session.currentState,
    });

    const greetPrompt = await buildSystemPrompt(session);
    const greetMessages = buildBedrockMessages(session);
    // Inject a synthetic user "tick" so Bedrock has a turn to respond to.
    // The new state's stateConversationTurns is empty (just reset on advance);
    // a one-word user nudge is enough to elicit the framing + Q1.
    greetMessages.push({
      role: "user",
      content: [{ text: "(continue)" }],
    });
    const greetTools = getStateTools(session.currentState, session);
    const greetHandler = getStateToolHandler(session.currentState, session);

    const greetResult = await callBedrock(greetPrompt, greetMessages, greetTools, greetHandler, {
      tenantId,
      sessionId,
    });

    if (greetResult.assistantMessage.trim()) {
      combinedMessage = `${result.assistantMessage}\n\n${greetResult.assistantMessage}`.trim();
      addAssistantTurn(session, greetResult.assistantMessage);
      // Same messageId as the main turn: the customer sees one combined bubble,
      // so feedback on it should resolve to this assistant reply either way.
      await appendRawHistory(
        tenantId,
        sessionId,
        "assistant",
        greetResult.assistantMessage,
        undefined,
        assistantMessageId,
      );
    }
  }

  if (stuckOnQuestion) {
    void appendLog(tenantId, sessionId, "loop-guard.detected", {
      state: session.currentState,
      questionFingerprint: stuckOnQuestion,
    });
  }

  // Post-process safety net: if the LLM produced a checklist-shaped reply in
  // a non-rendering state, rewrite it. The decision trees are the source of
  // truth; a free-form list here will drift from the resolved buckets the
  // side panel renders.
  const { text: guardedMessage, rewritten } = assertNoRogueChecklist(
    combinedMessage,
    session.currentState,
  );
  if (rewritten) {
    void appendLog(tenantId, sessionId, "rogue.checklist.rewritten", {
      state: session.currentState,
      originalMessageLen: combinedMessage.length,
    });
  }

  // Save session
  await updateSession(session);

  void appendLog(tenantId, sessionId, "message.completed", {
    finalState: session.currentState,
    assistantMessageLen: guardedMessage.length,
    kbSourceCount: result.kbSources.length,
    cascadeSteps,
    autoGreetRan,
    rogueChecklistRewritten: rewritten,
  });

  return {
    sessionId: session.sessionId,
    message: guardedMessage,
    state: session.currentState,
    structuredContext: session.structuredContext,
    kbSources: result.kbSources.length > 0 ? result.kbSources : undefined,
    messageId: assistantMessageId,
  };
}

/**
 * Run a single Bedrock round under the session's CURRENT state's prompt and
 * return the assistant message. Used by side-channel routes that advance
 * state outside processMessage (e.g. /authid-result) where there's no user
 * turn coming to drive the conversation forward. Unlike the in-band autoGreet
 * inside processMessage (which only fires when the new state's metadata flags
 * it — so we don't double-tap), side-channel callers ALWAYS need to greet the
 * customer because the alternative is silence. Persists the assistant turn
 * to memory + raw history. Returns null only when the state is terminal or
 * the model produced an empty reply.
 */
export async function runAutoGreet(tenantId: string, session: Session): Promise<string | null> {
  if (isTerminal(session.currentState)) return null;

  void appendLog(tenantId, session.sessionId, "auto-greet.start", {
    state: session.currentState,
    triggeredBy: "side-channel",
  });

  const greetPrompt = await buildSystemPrompt(session);
  const greetMessages = buildBedrockMessages(session);
  greetMessages.push({ role: "user", content: [{ text: "(continue)" }] });
  const greetTools = getStateTools(session.currentState, session);
  const greetHandler = getStateToolHandler(session.currentState, session);

  const greetResult = await callBedrock(greetPrompt, greetMessages, greetTools, greetHandler, {
    tenantId,
    sessionId: session.sessionId,
  });

  const text = greetResult.assistantMessage.trim();
  if (!text) return null;
  addAssistantTurn(session, text);
  await appendRawHistory(tenantId, session.sessionId, "assistant", text);
  return text;
}

/**
 * States where producing a document checklist is the explicit point. Outside
 * of these, the decision tree resolution has not yet finalized the canonical
 * list — any list the LLM emits comes from training data and will contradict
 * the resolved buckets the side panel renders.
 */
const RENDERING_STATES = new Set<string>(["confirm-facts", "upload-docs", "schedule", "confirm"]);

/**
 * Sanctioned punt when the guard rewrites a rogue checklist. Mirrors the
 * canonical mid-flow answer the prompts now instruct the LLM to use.
 */
const FALLBACK_MESSAGE =
  'I have your information so far — your full list of what to bring will be ready once we\'ve finished a couple more questions. Look at the "Your visit" panel on the right for live updates.';

/**
 * Detects a checklist-shaped reply in a non-rendering state and rewrites it.
 * Returns the (possibly rewritten) message + a boolean flag for logging.
 *
 * Heuristic is intentionally tight (precision >> recall) to avoid clobbering
 * legitimate numbered/bulleted answer chips:
 *   - A line-anchored header ("Required Documents", "What to Bring", etc.)
 *     fires the rewrite ONLY when followed by ≥3 list items. Prose mentions
 *     of these phrases ("the documents you'll need") don't trigger.
 *   - 5+ list items (numbered or bulleted) PLUS at least one document
 *     keyword (HSMV, certificate, title, registration, insurance, …).
 */
export function assertNoRogueChecklist(
  message: string,
  state: string,
): { text: string; rewritten: boolean } {
  if (RENDERING_STATES.has(state)) return { text: message, rewritten: false };

  const numberedItems = message.match(/^\s*\d+\.\s+\S/gm) ?? [];
  const bulletedItems = message.match(/^\s*[-*•]\s+\S/gm) ?? [];
  const total = numberedItems.length + bulletedItems.length;

  // Header-shaped lines (start of line, optional bold/heading marks). Must be
  // line-anchored so a prose mention like "the documents you'll need" doesn't
  // count. Combined with the list-length floor below to avoid clobbering Q&A
  // turns that happen to start with one of these phrases.
  const headerLine =
    /^[\s>*#_-]*(required documents|what to bring|here'?s your (?:full )?list|documents you'?ll need)\b/im;
  if (headerLine.test(message) && total >= 3) {
    return { text: FALLBACK_MESSAGE, rewritten: true };
  }

  // A fact question with many answer chips (e.g. "Which primary identity
  // document do you have? 1. US passport 2. Birth certificate …") looks like a
  // doc list to a naive keyword count, but it's a QUESTION — the customer is
  // picking one, not being handed a checklist. Questions contain a '?'; genuine
  // rogue checklists are declarative. So the keyword-count rule only fires when
  // the message is NOT a question.
  const isQuestion = message.includes("?");
  const docKeywords =
    /\b(HSMV|certificate|title|registration|insurance|passport|social security|VA letter|form|proof of address)\b/i;
  if (!isQuestion && total >= 5 && docKeywords.test(message)) {
    return { text: FALLBACK_MESSAGE, rewritten: true };
  }

  return { text: message, rewritten: false };
}

/**
 * Detect when the bot has asked essentially the same question 2+ times in a
 * row in the current state. Returns the question fingerprint (truncated first
 * sentence, lowercased, alphanumeric-only) when stuck, else null.
 *
 * 2-turn detection catches loops early — the soft remediation prompt nudges
 * the bot to acknowledge volunteered information before re-asking, which
 * preserves conversation quality. Pass-5 W4 confirmed that 3-turn detection
 * was too late; by then the bot had established a no-acknowledgement pattern.
 */
function detectQuestionLoop(session: Session): string | null {
  const turns = session.stateConversationTurns;
  const assistantTurns = turns.filter((t) => t.role === "assistant").slice(-3);
  if (assistantTurns.length < 2) return null;

  const fingerprint = (s: string): string => {
    // First question-like line: take up to first '?' or first 120 chars
    const trimmed = s.trim().replace(/^\*+|\*+$/g, "");
    const firstQ = trimmed.split("\n").find((l) => l.includes("?")) ?? trimmed;
    return firstQ
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
      .slice(0, 80);
  };

  const fps = assistantTurns.map((t) => fingerprint(t.content));
  const last = fps[fps.length - 1];
  if (!last || last.length < 10) return null;
  // Stuck if the last 2 fingerprints match
  if (fps.length >= 2 && fps[fps.length - 2] === last) return last;
  return null;
}
