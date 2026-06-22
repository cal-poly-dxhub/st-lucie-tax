import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

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
  appointmentDate: string;
  appointmentTime: string;
  officeName: string;
  qrCodeDataUrl: string;
  fromEmail: string;
}

export function buildQrConfirmationEmail(input: QrConfirmationInput): EmailInput {
  const html = `<p>Hi ${input.firstName},</p>
<p>Your appointment is confirmed:</p>
<ul>
  <li><strong>Date:</strong> ${input.appointmentDate}</li>
  <li><strong>Time:</strong> ${input.appointmentTime}</li>
  <li><strong>Location:</strong> ${input.officeName}</li>
</ul>
<p>Present this QR code at check-in:</p>
<img src="${input.qrCodeDataUrl}" alt="QR Code" width="200" height="200" />
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment is confirmed:
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
  appointmentId: number;
  deskNumber: number;
  officeName: string;
  fromEmail: string;
}

export function buildQueueSummonEmail(input: QueueSummonInput): EmailInput {
  const html = `<p>Hi ${input.firstName},</p>
<p><strong>It's your turn!</strong></p>
<p>Please proceed to <strong>Desk ${input.deskNumber}</strong> at ${input.officeName}.</p>
<p>Your appointment number: <strong>${input.appointmentId}</strong></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

It's your turn! Please proceed to Desk ${input.deskNumber} at ${input.officeName}.

Your appointment number: ${input.appointmentId}

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
  qrCode: string;
  baseUrl: string;
  fromEmail: string;
}

export function buildPrescreenLinkEmail(input: PrescreenLinkInput): EmailInput {
  const prescreenUrl = `${input.baseUrl}/prescreen/${input.qrCode}`;

  const html = `<p>Hi ${input.firstName},</p>
<p>Please complete your pre-screen questions before your appointment:</p>
<p><a href="${prescreenUrl}">${prescreenUrl}</a></p>
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
