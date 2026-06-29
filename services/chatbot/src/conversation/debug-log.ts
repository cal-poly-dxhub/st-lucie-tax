/**
 * Structured debug-log persistence.
 *
 * Writes one DynamoDB item per significant backend event (Bedrock I/O, tool
 * invocations, state transitions, errors) under the session's partition key
 * with SK `LOG#<ISO8601>#<eventType>#<seq>`. Callers fire-and-forget; this
 * module swallows all errors so a log-write failure can never break the
 * request path.
 *
 * Retention: general 3-year (not PII TTL). Logs are audit/debug events — the
 * personally-identifying content already lives in the session row + HISTORY#
 * items under the same PK.
 *
 * Mirrors raw-history.ts in shape.
 */

import { buildPk, generalRetentionTtl } from "@st-lucie/data-access";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "@st-lucie/data-access";

// Monotonic sequence counter per process. ISO8601 timestamps can collide for
// events emitted in the same millisecond; suffixing with #<seq> keeps SK
// ordering deterministic.
let seq = 0;
function nextSeq(): string {
  seq = (seq + 1) & 0xffff;
  return seq.toString(16).padStart(4, "0");
}

export async function appendLog(
  tenantId: string,
  sessionId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  try {
    const client = getDocClient();
    const tableName = getTableName();
    const timestamp = new Date().toISOString();
    const sk = `LOG#${timestamp}#${eventType}#${nextSeq()}`;

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: buildPk(tenantId, "SESSION", sessionId),
          SK: sk,
          entityType: "SESSION_LOG",
          sessionId,
          eventType,
          payload: sanitizePayload(payload),
          timestamp,
          ttl: generalRetentionTtl(),
        },
      }),
    );
  } catch (err) {
    // Never throw from a log-writer. A dropped log is acceptable; a broken
    // request path is not.
    const msg = err instanceof Error ? err.message : String(err);

    console.warn(`[debug-log] failed to append ${eventType} for ${sessionId}: ${msg}`);
  }
}

/**
 * DynamoDB DocumentClient handles most JS values but rejects `undefined` and
 * unbounded recursion. Strip undefineds + cap depth defensively, and redact
 * known PII from every string value (SEC-18 / NFR-SEC-03).
 */
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

/**
 * Redact PII from a log string (SEC-18 / NFR-SEC-03: no PII in application
 * logs). Applied to every string in a log payload — including the serialized
 * system prompt + conversation `messages`, where the bulk of citizen PII lives.
 *
 * SCOPE — what this catches:
 *   1. The structured `CUSTOMER IDENTITY: <name>, DOB: <dob>, Address: <addr>`
 *      line that structured-context.ts injects into the system prompt from
 *      AuthID OCR. This is the single richest PII source and has a known shape,
 *      so we redact its three values precisely.
 *   2. High-confidence standalone tokens anywhere in free text: email
 *      addresses, US SSNs, and Florida driver-license numbers (1 letter +
 *      12 digits, formatted or not).
 *
 * LIMITS — deliberately NOT a guarantee:
 *   We do NOT blind-redact arbitrary dates/numbers/words. A citizen who types
 *   their DOB or address as free prose ("I was born Jan 15 1980 at 4 Main St")
 *   is NOT fully scrubbed by these patterns — over-broad regex would also
 *   destroy the legitimate debug value of these logs (token counts, durations,
 *   timestamps, fact values). True model-layer scrubbing is SEC-06 (Bedrock
 *   Guardrails); moving logs off DynamoDB to CloudWatch is the SEC-18 endgame.
 *   This redactor is a meaningful reduction of the structured/high-confidence
 *   PII, not a complete one.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Florida DL: one letter + 12 digits, optionally hyphen/space grouped.
const FL_DL_RE = /\b[A-Za-z]\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{3}[- ]?\d\b|\b[A-Za-z]\d{12}\b/g;
// `CUSTOMER IDENTITY: <name>, DOB: <dob>, Address: <address>` — redact the
// three values while keeping the labels so the log still shows identity WAS
// present (useful for debugging the verify-identity flow) without the values.
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
