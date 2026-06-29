/**
 * Conversation memory strategy.
 *
 * Each Bedrock call receives:
 * 1. Current state's system prompt (via prompt-loader)
 * 2. Structured context summary from session (via structured-context)
 * 3. Only the conversation turns from the current state
 *
 * "Turns reset at each state transition."
 * "Full raw history persisted for records retention."
 */

import type { Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";

/**
 * Build Bedrock messages from the current state's conversation turns only.
 * Per spec: "only the conversation turns from the current state"
 */
export function buildBedrockMessages(session: Session): Message[] {
  return session.stateConversationTurns.map((turn) => ({
    role: turn.role as "user" | "assistant",
    content: [{ text: turn.content }] as ContentBlock[],
  }));
}

/**
 * Add a user turn to the current state's conversation.
 */
export function addUserTurn(session: Session, message: string): void {
  session.stateConversationTurns.push({
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add an assistant turn to the current state's conversation.
 */
export function addAssistantTurn(session: Session, message: string): void {
  session.stateConversationTurns.push({
    role: "assistant",
    content: message,
    timestamp: new Date().toISOString(),
  });
}
