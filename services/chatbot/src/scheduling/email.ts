import {
  SESv2Client,
  SendEmailCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
} from "@aws-sdk/client-sesv2";

const REGION = process.env.AWS_REGION || "us-east-1";
const FROM_EMAIL = process.env.EMAIL || "noreply@localhost";

const ses = new SESv2Client({ region: REGION });

export { ses, FROM_EMAIL };

export interface QrConfirmationInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  appointmentDate: string;
  appointmentTime: string;
  officeName: string;
}

export function buildQrConfirmationEmail(input: QrConfirmationInput) {
  const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(input.confirmationCode)}`;

  const html = `<p>Hi ${escapeHtml(input.firstName)},</p>
<p>Your appointment is confirmed:</p>
<ul>
  <li><strong>Confirmation Code:</strong> ${escapeHtml(input.confirmationCode)}</li>
  <li><strong>Date:</strong> ${escapeHtml(input.appointmentDate)}</li>
  <li><strong>Time:</strong> ${escapeHtml(input.appointmentTime)}</li>
  <li><strong>Location:</strong> ${escapeHtml(input.officeName)}</li>
</ul>
<p>Present this QR code at check-in:</p>
<img src="${qrDataUrl}" alt="QR Code" width="200" height="200" />
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment is confirmed:
- Confirmation Code: ${input.confirmationCode}
- Date: ${input.appointmentDate}
- Time: ${input.appointmentTime}
- Location: ${input.officeName}

Please present your QR code at check-in.

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: FROM_EMAIL,
    subject: "Appointment Confirmed",
    html,
    text,
  };
}

export async function sendConfirmationEmail(input: QrConfirmationInput): Promise<void> {
  const email = buildQrConfirmationEmail(input);
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: email.from,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject },
          Body: {
            Html: { Data: email.html },
            Text: { Data: email.text },
          },
        },
      },
    }),
  );
}

export async function verifyEmailIdentity(
  email: string,
): Promise<"verification_sent" | "already_verified"> {
  try {
    const result = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    if (result.VerifiedForSendingStatus) return "already_verified";
  } catch {
    // Identity doesn't exist yet
  }
  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "AlreadyExistsException") return "already_verified";
    throw err;
  }
  return "verification_sent";
}

export async function checkEmailVerified(email: string): Promise<boolean> {
  try {
    const result = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    return result.VerifiedForSendingStatus === true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
