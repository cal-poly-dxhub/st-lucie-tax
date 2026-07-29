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
    session.structuredContext.suggestedReplies = [];
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
  // Tool provenance across BOTH rounds (main + autoGreet), for the fee detector
  // and the chips fallback below.
  let combinedToolResultText = result.toolResultText;
  const combinedCalledTools = new Set(result.calledToolNames);
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

    combinedToolResultText += greetResult.toolResultText;
    for (const n of greetResult.calledToolNames) combinedCalledTools.add(n);
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

  // Fee-fabrication monitor (log-only, never rewrites). If the reply states a
  // dollar amount that did NOT come from a tool result this turn, the model
  // likely recalled it from training data — the exact failure in session
  // 17cf4d9a where it invented "$48.00 + $6.25 = $54.25" for DL fees. We don't
  // scrub (legitimate fees like a KB-sourced "$48.00" or an item-note fee must
  // survive); we flag for telemetry so the prompt rule's effectiveness is
  // measurable.
  const emittedAmounts = (guardedMessage.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) ?? []).map((a) =>
    a.replace(/\$\s+/, "$"),
  );
  if (emittedAmounts.length > 0) {
    const sourceText = combinedToolResultText.replace(/\$\s+/g, "$");
    const unsourced = [...new Set(emittedAmounts)].filter((a) => !sourceText.includes(a));
    if (unsourced.length > 0) {
      void appendLog(tenantId, sessionId, "fee.unsourced", {
        state: session.currentState,
        amounts: unsourced,
      });
    }
  }

  // Chips fallback (Issue 3). The LLM is told to call set_suggested_replies on
  // every turn but forgets ~30% of the time, leaving the customer with no
  // tappable chips. When it skipped the tool AND left chips empty AND the reply
  // is a parseable numbered option list, harvest the options deterministically.
  // Tightly gated to avoid clobbering: only when we stayed in the same state
  // (no reset/advance race), the guard didn't rewrite, the tool wasn't called
  // (respects an explicit "no chips" empty-array intent), and not in a
  // doc-rendering state.
  const suggestedRepliesToolCalled = combinedCalledTools.has("set_suggested_replies");
  if (
    session.currentState === stateAtEntry &&
    !rewritten &&
    !suggestedRepliesToolCalled &&
    !RENDERING_STATES.has(session.currentState) &&
    (session.structuredContext.suggestedReplies?.length ?? 0) === 0
  ) {
    const parsed = parseSuggestedRepliesFromMessage(guardedMessage);
    if (parsed.length >= 2) {
      session.structuredContext.suggestedReplies = parsed;
      void appendLog(tenantId, sessionId, "suggested-replies.fallback", {
        state: session.currentState,
        count: parsed.length,
      });
    }
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
    suggestedRepliesToolCalled,
    suggestedRepliesFinalCount: session.structuredContext.suggestedReplies?.length ?? 0,
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

  // Shared by Rules 1 & 3. Broad keyword set — fine for header/structural rules
  // that already require a checklist shape; NOT used by Rule 2 (see below).
  const docKeywords =
    /\b(HSMV|certificate|title|registration|insurance|passport|social security|VA letter|form|proof of address)\b/i;

  // Header-shaped lines (start of line, optional bold/heading marks). Must be
  // line-anchored so a prose mention like "the documents you'll need" doesn't
  // count. Combined with the list-length floor below to avoid clobbering Q&A
  // turns that happen to start with one of these phrases.
  const headerLine =
    /^[\s>*#_-]*(required documents|what to bring|here'?s your (?:full )?list|documents you'?ll need)\b/im;
  if (headerLine.test(message) && total >= 3) {
    return { text: FALLBACK_MESSAGE, rewritten: true };
  }

  // Rule 3 — multi-category checklist (the turn-7 escape: 4 bold section headers
  // like "**Primary Identity Document**", 11 bullets, doc keywords, trailing
  // courtesy "?"). A standalone bold *category-header* line is a line whose
  // ENTIRE content is a bold span with no '?' inside it. A multiple-choice fact
  // question has ZERO such lines: its one bold span is the question STEM and
  // ends with '?', which [^*\n?]+ plus the end anchor exclude. Three+ category
  // headers + 5+ items + a doc keyword is a "what to bring" dump — fire even
  // when the reply ends with a trailing courtesy question.
  const boldHeaderLines = message.match(/^[ \t>]*\*\*[^*\n?]+\*\*[ \t]*$/gm) ?? [];
  if (boldHeaderLines.length >= 3 && total >= 5 && docKeywords.test(message)) {
    return { text: FALLBACK_MESSAGE, rewritten: true };
  }

  // Rule 2 — flat declarative checklist. A genuine framing question puts its '?'
  // at or above the list (the question STEM, e.g. "Which document do you have?
  // 1. … 2. …"); a trailing courtesy '?' BELOW the last list item does not make
  // a declarative list a question. Only a framing question suppresses this rule,
  // so a flat checklist ending in "…anything else?" is still caught.
  const lines = message.split("\n");
  let lastListIdx = -1;
  let firstQIdx = -1;
  lines.forEach((l, i) => {
    if (/^\s*(?:\d+\.|[-*•])\s+\S/.test(l)) lastListIdx = i;
    if (firstQIdx === -1 && l.includes("?")) firstQIdx = i;
  });
  const framingQuestion = firstQIdx !== -1 && (lastListIdx === -1 || firstQIdx <= lastListIdx);
  // NARROW trigger (NOT the broad docKeywords): a lead phrase OR a doc-ONLY
  // token. Dropping title/registration/form/insurance and requiring one of
  // these is what keeps prompt-mandated transaction menus (which contain
  // "title"/"registration") from being rewritten — verified against the
  // Top-5-stuck, new-resident, and ambiguous-purchase menus in default-prompts.
  const leadPhrase =
    /\b(what to bring|you'?ll need|you will need|bring with you|here'?s what you'?ll|required documents|bring the following)\b/i;
  const docOnlyKeywords =
    /\b(HSMV|passport|social security|VA letter|proof of address|birth certificate|naturalization|W-2|pay stub|utility bill)\b/i;
  if (
    !framingQuestion &&
    total >= 5 &&
    (leadPhrase.test(message) || docOnlyKeywords.test(message))
  ) {
    return { text: FALLBACK_MESSAGE, rewritten: true };
  }

  return { text: message, rewritten: false };
}

/**
 * Deterministic fallback for the chips (set_suggested_replies) compliance gap.
 * When the LLM presents a NUMBERED option list but forgot to call the tool,
 * harvest the options into quick-reply chips so the customer can still tap.
 *
 * NUMBERED lists only — dash bullets are reserved for facts/items per the
 * formatting rule, so harvesting them risks grabbing a rogue checklist. Each
 * candidate label is cleaned and validated to look like a short OPTION, not a
 * sentence or a document name:
 *   - strip markdown emphasis + a trailing "— gloss" / "(parenthetical)";
 *   - reject empty, >60 chars, >8 words, ending in '?', or ending in '.'/'!'/';'
 *     (a procedure step like "1. First, gather your documents." is not an option);
 *   - reject an internal sentence break (prose, not a label).
 * Then, if ≥2 surviving labels look like document names, the whole thing is a
 * rogue doc list, not a menu — return []. Returns [] unless ≥2 chips survive.
 */
export function parseSuggestedRepliesFromMessage(
  message: string,
): Array<{ label: string; value: string }> {
  const numbered = message.match(/^\s*\d+\.\s+(.+?)\s*$/gm) ?? [];
  if (numbered.length < 2) return [];

  const out: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const raw of numbered) {
    let label = raw.replace(/^\s*\d+\.\s+/, "").trim();
    // Strip markdown emphasis markers.
    label = label.replace(/[*_`]/g, "").trim();
    // Strip a trailing "— explanation" / "- explanation" gloss and a trailing
    // "(parenthetical)" so "Renew online — fastest option" -> "Renew online".
    label = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    label = label.replace(/\s*[—-]\s+.*$/, "").trim();
    if (!label) continue;
    if (label.length > 60) continue;
    if (label.split(/\s+/).length > 8) continue;
    if (label.endsWith("?")) continue;
    if (/[.!;]$/.test(label)) continue; // procedure step / sentence
    if (/[.?!](\s|$)/.test(label.slice(0, -1))) continue; // internal sentence break
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: label });
    if (out.length >= 8) break;
  }

  // If multiple options are document names, this is a rogue doc checklist
  // rendered as a numbered list, not a routing menu — don't make chips of it.
  // NARROW doc-only set: must NOT include title/registration/form/insurance,
  // which appear in legitimate transaction menus.
  const DOC_ONLY =
    /\b(HSMV|passport|social security|VA letter|proof of address|birth certificate|divorce decree|court order|marriage certificate|naturalization|certified|W-2|pay stub|utility bill|bank statement)\b/i;
  if (out.filter((o) => DOC_ONLY.test(o.label)).length >= 2) return [];

  return out.length >= 2 ? out : [];
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
