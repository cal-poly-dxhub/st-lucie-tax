/**
 * Transcript email dispatcher.
 *
 * Loads the session + its conversation history, builds an email, and sends it
 * via SES. When `SES_FROM_ADDRESS` is not set (local dev) the send becomes a
 * no-op that still builds the content and logs it — so the flow can be tested
 * without provisioning SES.
 */

import { getSession } from "../session/get-session.js";
import { query } from "@st-lucie/data-access";
import { buildTranscriptEmail } from "./transcript-template.js";
import { sendEmail } from "./ses-client.js";

export interface SendTranscriptResult {
  status: "sent" | "skipped" | "failed";
  messageId?: string;
  reason?: string;
}

export async function sendTranscriptForSession(
  tenantId: string,
  sessionId: string,
  to: string,
): Promise<SendTranscriptResult> {
  const session = await getSession(tenantId, sessionId);
  if (!session) {
    return { status: "failed", reason: "session-not-found" };
  }

  const historyItems = await query(tenantId, "SESSION", sessionId, "HISTORY#");
  const transcript = historyItems
    .sort((a, b) => String(a.SK).localeCompare(String(b.SK)))
    .map((h) => ({
      role: (h.role as "user" | "assistant") ?? "assistant",
      content: String(h.content ?? ""),
    }));

  const email = buildTranscriptEmail({ session, transcript });

  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (!fromAddress) {
    console.log(
      `[transcript] SES_FROM_ADDRESS unset — would send to ${to}, subject: "${email.subject}"`,
    );
    return { status: "skipped", reason: "no-from-address" };
  }

  try {
    const messageId = await sendEmail({
      from: fromAddress,
      to,
      subject: email.subject,
      textBody: email.textBody,
      htmlBody: email.htmlBody,
    });
    return { status: "sent", messageId };
  } catch (err) {
    console.error("SES send failed:", err);
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
