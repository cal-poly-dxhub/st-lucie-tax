/**
 * Admin write: mark a session reviewed / not-reviewed.
 *
 * Targeted single-attribute update on chat_sessions.reviewed_at.
 */

import { setSessionReviewedAt } from "@st-lucie/data-access";

export async function setSessionReviewed(
  sessionId: string,
  reviewed: boolean,
): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const updated = await setSessionReviewedAt(sessionId, reviewed);
  if (!updated) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true };
}
