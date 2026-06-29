/**
 * Full raw conversation history persistence via chat_messages table.
 *
 * Each user/assistant turn is stored as a row in chat_messages with the
 * session's current state. The 3-year Florida public records retention
 * requirement is met by database-level retention policy rather than TTL.
 */

import { insertChatMessage, getChatSession } from "@st-lucie/data-access";

export async function appendRawHistory(
  tenantId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  rawContent?: unknown,
  messageId?: string,
): Promise<void> {
  const session = await getChatSession(sessionId);
  if (!session) return;

  await insertChatMessage({
    sessionId: session.id,
    role,
    content: {
      text: content,
      ...(rawContent ? { raw: rawContent } : {}),
      ...(messageId ? { messageId } : {}),
    },
    state: session.state,
  });
}
