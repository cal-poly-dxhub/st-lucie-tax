/**
 * Structured context builder.
 *
 * Each Bedrock call receives a structured context summary built from the
 * DynamoDB session record. This carries forward across state transitions
 * while conversation turns reset.
 */

import type { StructuredContext } from "@st-lucie/shared-types";

export function createEmptyContext(): StructuredContext {
  return {
    identity: undefined,
    transactions: [],
    documents: [],
    preScreening: {
      answers: {},
      completedTxnTypes: [],
    },
    scheduling: undefined,
    facts: {},
  };
}

/**
 * Build a text summary of the structured context for inclusion in the
 * Bedrock system prompt. Keeps token usage bounded per spec.
 */
export function buildContextSummary(ctx: StructuredContext): string {
  const parts: string[] = [];

  if (ctx.identity?.confirmed) {
    parts.push(
      `CUSTOMER IDENTITY: ${ctx.identity.name || "Unknown"}, DOB: ${ctx.identity.dob || "Unknown"}, Address: ${ctx.identity.address || "Unknown"}`,
    );
  }

  if (ctx.transactions.length > 0) {
    const txnList = ctx.transactions
      .map(
        (t) =>
          `- ${t.name} (${t.txnTypeId}): ${t.status}, ${t.durationMinutes} min${t.blockedReason ? ` [BLOCKED: ${t.blockedReason}]` : ""}`,
      )
      .join("\n");
    const activeOnly = ctx.transactions.filter((t) => t.status === "active");
    const totalDuration = activeOnly.reduce((sum, t) => sum + t.durationMinutes, 0);
    parts.push(
      `SELECTED TRANSACTIONS (${activeOnly.length} active, ${totalDuration} min total):\n${txnList}`,
    );
  }

  if (ctx.documents.length > 0) {
    const docList = ctx.documents.map((d) => `- ${d.documentType}: ${d.status}`).join("\n");
    parts.push(`DOCUMENTS:\n${docList}`);
  }

  const answeredCount = Object.keys(ctx.preScreening.answers).length;
  if (answeredCount > 0) {
    parts.push(
      `PRE-SCREENING: ${answeredCount} questions answered, ${ctx.preScreening.completedTxnTypes.length} transaction types complete`,
    );
  }

  if (ctx.scheduling?.appointmentId) {
    parts.push(
      `APPOINTMENT: ${ctx.scheduling.appointmentId} at ${ctx.scheduling.selectedSlot?.locationName} on ${ctx.scheduling.selectedSlot?.date} ${ctx.scheduling.selectedSlot?.startTime}`,
    );
  }

  const factKeys = Object.keys(ctx.facts ?? {});
  if (factKeys.length > 0) {
    const factList = factKeys
      .map((k) => {
        const fv = ctx.facts[k];
        return `- ${k}: ${fv.value} (${fv.confidence}, via ${fv.source})`;
      })
      .join("\n");
    parts.push(`KNOWN FACTS:\n${factList}`);
  }

  return parts.length > 0
    ? `--- SESSION CONTEXT ---\n${parts.join("\n\n")}\n--- END CONTEXT ---`
    : "";
}
