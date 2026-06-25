import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { escapeHtml } from "./utils.js";

export interface EmailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(ses: SESv2Client, input: EmailInput): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: {
            Html: { Data: input.html },
            Text: { Data: input.text },
          },
        },
      },
    }),
  );
}

export interface QrConfirmationInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  appointmentDate: string;
  appointmentTime: string;
  officeName: string;
  qrCodeDataUrl: string;
  fromEmail: string;
}

export function buildQrConfirmationEmail(input: QrConfirmationInput): EmailInput {
  const name = escapeHtml(input.firstName);
  const code = escapeHtml(input.confirmationCode);
  const date = escapeHtml(input.appointmentDate);
  const time = escapeHtml(input.appointmentTime);
  const office = escapeHtml(input.officeName);

  const html = `<p>Hi ${name},</p>
<p>Your appointment is confirmed:</p>
<ul>
  <li><strong>Confirmation Code:</strong> ${code}</li>
  <li><strong>Date:</strong> ${date}</li>
  <li><strong>Time:</strong> ${time}</li>
  <li><strong>Location:</strong> ${office}</li>
</ul>
<p>Present this QR code at check-in:</p>
<img src="${input.qrCodeDataUrl}" alt="QR Code" width="200" height="200" />
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment is confirmed:
- Confirmation Code: ${input.confirmationCode}
- Date: ${input.appointmentDate}
- Time: ${input.appointmentTime}
- Location: ${input.officeName}

Please present your QR code at check-in (see attached image in the HTML version of this email).

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: input.fromEmail,
    subject: "Appointment Confirmed",
    html,
    text,
  };
}

export interface QueueSummonInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  deskNumber: number;
  officeName: string;
  fromEmail: string;
}

export function buildQueueSummonEmail(input: QueueSummonInput): EmailInput {
  const name = escapeHtml(input.firstName);
  const office = escapeHtml(input.officeName);
  const code = escapeHtml(input.confirmationCode);

  const html = `<p>Hi ${name},</p>
<p><strong>It's your turn!</strong></p>
<p>Please proceed to <strong>Desk ${input.deskNumber}</strong> at ${office}.</p>
<p>Your confirmation code: <strong>${code}</strong></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

It's your turn! Please proceed to Desk ${input.deskNumber} at ${input.officeName}.

Your confirmation code: ${input.confirmationCode}

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: input.fromEmail,
    subject: `It's Your Turn — Desk ${input.deskNumber}`,
    html,
    text,
  };
}

export interface PrescreenLinkInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  baseUrl: string;
  fromEmail: string;
}

export function buildPrescreenLinkEmail(input: PrescreenLinkInput): EmailInput {
  const prescreenUrl = `${input.baseUrl}/prescreen/${input.confirmationCode}`;
  const name = escapeHtml(input.firstName);
  const escapedUrl = escapeHtml(prescreenUrl);

  const html = `<p>Hi ${name},</p>
<p>Please complete your pre-screen questions before your appointment:</p>
<p><a href="${escapedUrl}">${escapedUrl}</a></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Please complete your pre-screen questions before your appointment:
${prescreenUrl}

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: input.fromEmail,
    subject: "Complete Your Pre-Screen Questions",
    html,
    text,
  };
}
