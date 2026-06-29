/**
 * Persist session state changes to DynamoDB.
 */

import type { Session } from "@st-lucie/shared-types";
import { buildPk, putItem, piiTtl } from "@st-lucie/data-access";

export async function updateSession(session: Session): Promise<void> {
  session.updatedAt = new Date().toISOString();
  session.ttl = piiTtl(); // Refresh TTL on every update

  await putItem(session.tenantId, {
    PK: buildPk(session.tenantId, "SESSION", session.sessionId),
    SK: "METADATA",
    entityType: "SESSION",
    ...session,
  });
}
