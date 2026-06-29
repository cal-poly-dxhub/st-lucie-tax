/**
 * Structured debug-log persistence via chat_messages table.
 *
 * Writes one row per significant backend event (Bedrock I/O, tool
 * invocations, state transitions, errors) as role='system' messages.
 * Callers fire-and-forget; this module swallows all errors so a log-write
 * failure can never break the request path.
 */

import { insertChatMessage, getChatSession } from "@st-lucie/data-access";

export async function appendLog(
  tenantId: string,
  sessionId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  try {
    const session = await getChatSession(sessionId);
    if (!session) return;

    await insertChatMessage({
      sessionId: session.id,
      role: "system",
      content: {
        eventType,
        payload: sanitizePayload(payload),
        timestamp: new Date().toISOString(),
      },
      state: session.state,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[debug-log] failed to append ${eventType} for ${sessionId}: ${msg}`);
  }
}

function sanitizePayload(input: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (input === undefined) return null;
  if (input === null) return null;
  if (typeof input === "string") return redactPii(input);
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((v) => sanitizePayload(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = sanitizePayload(v, depth + 1);
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const FL_DL_RE = /\b[A-Za-z]\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{3}[- ]?\d\b|\b[A-Za-z]\d{12}\b/g;
const IDENTITY_LINE_RE = /CUSTOMER IDENTITY:[^\n]*?, DOB:[^\n]*?, Address:[^\n]*?(?=\n|$)/g;

export function redactPii(text: string): string {
  return text
    .replace(
      IDENTITY_LINE_RE,
      "CUSTOMER IDENTITY: [REDACTED-NAME], DOB: [REDACTED-DOB], Address: [REDACTED-ADDR]",
    )
    .replace(EMAIL_RE, "[REDACTED-EMAIL]")
    .replace(SSN_RE, "[REDACTED-SSN]")
    .replace(FL_DL_RE, "[REDACTED-DL]");
}
