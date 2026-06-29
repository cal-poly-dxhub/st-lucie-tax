/**
 * Full raw conversation history persistence.
 * Per spec: "Full raw history persisted for the 3-year Florida public records
 * retention requirement"
 *
 * Stored separately from per-state turns. Does NOT have PII TTL.
 */

import { buildPk } from "@st-lucie/data-access";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "@st-lucie/data-access";

export async function appendRawHistory(
  tenantId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  rawContent?: unknown,
  messageId?: string,
): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();
  const timestamp = new Date().toISOString();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: buildPk(tenantId, "SESSION", sessionId),
        SK: `HISTORY#${timestamp}`,
        entityType: "SESSION_HISTORY",
        sessionId,
        role,
        content,
        rawContent,
        timestamp,
        // messageId links this assistant turn to its per-message feedback rows
        // (SK = FEEDBACK#MESSAGE#<messageId>#<reaction>) so the admin can render
        // feedback inline. Only assistant turns carry one; omitted for user turns.
        ...(messageId ? { messageId } : {}),
        // No TTL — 3-year retention requirement
      },
    }),
  );
}
