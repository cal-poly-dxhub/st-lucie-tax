/**
 * Admin write: mark a session reviewed / not-reviewed.
 *
 * This is the admin service's ONLY write path. It does a targeted DynamoDB
 * UpdateCommand that sets a single attribute (`reviewed`) on the session's
 * METADATA row — it deliberately does NOT read-modify-write the whole session,
 * so it can never clobber concurrent chatbot writes to the same row.
 *
 * A condition expression ensures the session actually exists (so a bad id
 * returns 404 rather than silently creating a stub row).
 */

import { buildPk, getDocClient, getTableName } from "@st-lucie/data-access";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TENANT_ID = process.env.TENANT_ID || "stlucie";

export async function setSessionReviewed(
  sessionId: string,
  reviewed: boolean,
): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const client = getDocClient();
  const tableName = getTableName();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: buildPk(TENANT_ID, "SESSION", sessionId),
          SK: "METADATA",
        },
        UpdateExpression: "SET reviewed = :r",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: { ":r": reviewed },
      }),
    );
    return { ok: true };
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return { ok: false, reason: "not-found" };
    }
    throw err;
  }
}
