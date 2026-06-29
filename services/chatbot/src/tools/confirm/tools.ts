/**
 * Tools for the confirm state (terminal).
 * is stubbed — logs notification content.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";

export const confirmTools: Tool[] = [
  {
    toolSpec: {
      name: "get_appointment_summary",
      description: "Get the full appointment summary for the confirmation message.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
];

export interface ConfirmToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export async function handleConfirmTool(
  toolName: string,
  _input: Record<string, unknown>,
  session: Session,
): Promise<ConfirmToolResult> {
  switch (toolName) {
    case "get_appointment_summary":
      return handleGetSummary(session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

function handleGetSummary(session: Session): ConfirmToolResult {
  const sched = session.structuredContext.scheduling;
  const activeTransactions = session.structuredContext.transactions.filter(
    (t) => t.status === "active",
  );
  const totalDuration = activeTransactions.reduce((sum, t) => sum + t.durationMinutes, 0);

  // Collect all required documents (deduplicated)
  const docs = session.structuredContext.documents
    .filter((d) => d.status !== "skipped")
    .map((d) => d.documentType);

  // Log notification (stub)
  console.log("[STUB] Sending appointment confirmation:");
  console.log(`  Appointment: ${sched?.appointmentId}`);
  console.log(`  Location: ${sched?.selectedSlot?.locationName}`);
  console.log(`  Date: ${sched?.selectedSlot?.date} ${sched?.selectedSlot?.startTime}`);
  console.log(`  SMS would be sent to customer`);
  console.log(`  Email would be sent with QR code`);

  return {
    content: [
      {
        text: JSON.stringify({
          appointmentId: sched?.appointmentId,
          location: sched?.selectedSlot?.locationName || "TBD",
          address: "2300 Virginia Ave, Fort Pierce, FL 34982",
          date: sched?.selectedSlot?.date,
          time: sched?.selectedSlot?.startTime,
          transactions: activeTransactions.map((t) => ({
            name: t.name,
            durationMinutes: t.durationMinutes,
            status: t.status,
          })),
          totalDurationMinutes: totalDuration,
          qrCodeUrl: sched?.qrCodeUrl,
          incompletePreWork: session.incompletePreWork,
          documentsToRemember: docs,
          identity: session.structuredContext.identity,
          notificationsSent: {
            sms: "Confirmation SMS queued",
            email: "Confirmation email with QR code queued",
          },
        }),
      },
    ],
  };
}
