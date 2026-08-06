/**
 * Transcript email dispatcher.
 *
 * Loads the session + its conversation history, builds an email, and sends it
 * via SES. When `SES_FROM_ADDRESS` is not set (local dev) the send becomes a
 * no-op that still builds the content and logs it — so the flow can be tested
 * without provisioning SES.
 */

import { getSession } from "../session/get-session.js";
import { getChatSession, getChatMessages } from "@st-lucie/data-access";
import { buildTranscriptEmail } from "./transcript-template.js";
import { sendEmail } from "@st-lucie/office-ops/email";

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

  const sessionRow = await getChatSession(sessionId);
  const messages = sessionRow ? await getChatMessages(sessionRow.id) : [];
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const content = m.content as Record<string, unknown>;
      return {
        role: m.role as "user" | "assistant",
        content: (content.text as string) ?? "",
      };
    });

  const email = buildTranscriptEmail({ session, transcript });

  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (!fromAddress) {
    console.log(
      `[transcript] SES_FROM_ADDRESS unset — would send to ${to}, subject: "${email.subject}"`,
    );
    return { status: "skipped", reason: "no-from-address" };
  }

  try {
    await sendEmail({
      from: fromAddress,
      to,
      subject: email.subject,
      html: email.htmlBody,
      text: email.textBody,
    });
    return { status: "sent" };
  } catch (err) {
    console.error("SES send failed:", err);
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
