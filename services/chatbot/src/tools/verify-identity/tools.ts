/**
 * Tools for the verify-identity state — AuthID Proof flow.
 *
 * Replaces the prior Bedrock-multimodal OCR step. The bot opens an
 * AuthID Proof transaction; the frontend mounts <authid-component>
 * to capture DL+selfie; the user completes the flow; the frontend
 * POSTs to /chatbot/sessions/{id}/authid-result, our backend polls
 * AuthID for status + result, applies the decision matrix, and
 * advances state.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";
import {
  createProofTransaction,
  buildProofEmbedUrl,
  getOperationStatus,
  ensureAccountExists,
} from "../../authid/client.js";
import { updateSession } from "../../session/update-session.js";

const DL_DOC_TYPE_CODE = process.env.AUTHID_DL_DOC_TYPE_CODE ?? "5";

export const verifyIdentityTools: Tool[] = [
  {
    toolSpec: {
      name: "start_authid_proof",
      description:
        "Open an AuthID Proof identity-verification transaction. Call this once when entering the verify-identity state. Returns an embed URL the frontend uses to mount the <authid-component> for DL capture + selfie + liveness. The frontend tracks completion automatically — you do NOT need to call check_authid_status afterwards unless the customer asks for status.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            customerMessage: {
              type: "string",
              description:
                "A short, warm message to display before the AuthID widget mounts. Example: 'I'll need to verify your identity — please scan your driver license and take a quick selfie.'",
            },
          },
          required: ["customerMessage"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "check_authid_status",
      description:
        "Check the current status of the in-flight AuthID Proof transaction. Returns one of: pending, accepted, failed. Use sparingly — the frontend polls automatically.",
      inputSchema: { json: { type: "object" as const, properties: {} } },
    },
  },
];

export interface VerifyIdentityToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  uiAction?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function handleVerifyIdentityTool(
  toolName: string,
  _input: Record<string, unknown>,
  session: Session,
): Promise<VerifyIdentityToolResult> {
  switch (toolName) {
    case "start_authid_proof":
      return startProof(session);
    case "check_authid_status":
      return checkStatus(session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

async function startProof(session: Session): Promise<VerifyIdentityToolResult> {
  if (!session.authIdAccountNumber) {
    // Backfill for sessions created before AuthID rollout.
    session.authIdAccountNumber = session.betaTesterEmail ?? `dev-${session.sessionId}`;
  }
  const accountNumber = session.authIdAccountNumber;

  // AuthID can be unreachable / token-expired. That must NOT fail the whole
  // turn — the customer should still reach the verify/skip gate, where Skip
  // always works and Verify lights up only if the transaction was created.
  try {
    await ensureAccountExists({ accountNumber, email: session.betaTesterEmail });
    const txn = await createProofTransaction({ accountNumber, documentTypeCode: DL_DOC_TYPE_CODE });
    const embedUrl = buildProofEmbedUrl(txn.OperationId, txn.OneTimeSecret);
    session.authIdOperationId = txn.OperationId;
    session.pendingAuthIdProof = { embedUrl, operationId: txn.OperationId, mode: "proof" };
    await updateSession(session);
    return {
      content: [
        {
          text: JSON.stringify({
            status: "transaction-created",
            guidance:
              "Tell the customer they can verify now or skip, using the buttons below. Do NOT recite any URL — the frontend renders the choice and the widget.",
          }),
        },
      ],
      uiAction: { type: "authid-proof", embedUrl, operationId: txn.OperationId },
    };
  } catch (err) {
    console.error("start_authid_proof failed — offering skip-only gate:", err);
    session.pendingAuthIdProof = undefined;
    await updateSession(session);
    return {
      content: [
        {
          text: JSON.stringify({
            status: "verification-unavailable",
            guidance:
              "Identity verification is temporarily unavailable. Tell the customer they can continue now and verify in person at the office, using the Skip button below. Keep it brief and reassuring.",
          }),
        },
      ],
      uiAction: { type: "authid-unavailable" },
    };
  }
}

async function checkStatus(session: Session): Promise<VerifyIdentityToolResult> {
  if (!session.authIdOperationId) {
    return {
      content: [
        {
          text: JSON.stringify({
            status: "no-transaction",
            guidance: "Call start_authid_proof first.",
          }),
        },
      ],
    };
  }
  const s = await getOperationStatus(session.authIdOperationId);
  const map: Record<number, string> = { 0: "pending", 1: "accepted" };
  const human = map[s.Status] ?? "failed";
  return { content: [{ text: JSON.stringify({ status: human, raw: s.Status }) }] };
}
