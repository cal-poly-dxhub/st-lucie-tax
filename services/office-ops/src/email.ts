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
  baseUrl: string;
  fromEmail: string;
}

export function buildQrConfirmationEmail(input: QrConfirmationInput): EmailInput {
  const name = escapeHtml(input.firstName);
  const code = escapeHtml(input.confirmationCode);
  const date = escapeHtml(input.appointmentDate);
  const time = escapeHtml(input.appointmentTime);
  const office = escapeHtml(input.officeName);
  const queueStatusUrl = `${input.baseUrl}/queue-status/${input.confirmationCode}`;
  const escapedQueueStatusUrl = escapeHtml(queueStatusUrl);
  const manageUrl = `${input.baseUrl}/manage/${input.confirmationCode}`;
  const escapedManageUrl = escapeHtml(manageUrl);

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
<p>You can check your status in the queue here:<br>
<a href="${escapedQueueStatusUrl}">${escapedQueueStatusUrl}</a></p>
<p>Need to reschedule or cancel? Manage your appointment here:<br>
<a href="${escapedManageUrl}">${escapedManageUrl}</a></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment is confirmed:
- Confirmation Code: ${input.confirmationCode}
- Date: ${input.appointmentDate}
- Time: ${input.appointmentTime}
- Location: ${input.officeName}

Please present your QR code at check-in (see attached image in the HTML version of this email).

You can check your status in the queue here:
${queueStatusUrl}

Need to reschedule or cancel? Manage your appointment here:
${manageUrl}

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

export interface CancellationEmailInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  appointmentDate: string;
  appointmentTime: string;
  officeName: string;
  fromEmail: string;
}

export function buildCancellationEmail(input: CancellationEmailInput): EmailInput {
  const name = escapeHtml(input.firstName);
  const code = escapeHtml(input.confirmationCode);
  const date = escapeHtml(input.appointmentDate);
  const time = escapeHtml(input.appointmentTime);
  const office = escapeHtml(input.officeName);

  const html = `<p>Hi ${name},</p>
<p>Your appointment has been cancelled.</p>
<ul>
  <li><strong>Confirmation Code:</strong> ${code}</li>
  <li><strong>Original Date:</strong> ${date}</li>
  <li><strong>Original Time:</strong> ${time}</li>
  <li><strong>Location:</strong> ${office}</li>
</ul>
<p>If you did not request this cancellation, or would like to book a new appointment, please visit our scheduling page or contact our office.</p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment has been cancelled.
- Confirmation Code: ${input.confirmationCode}
- Original Date: ${input.appointmentDate}
- Original Time: ${input.appointmentTime}
- Location: ${input.officeName}

If you did not request this cancellation, or would like to book a new appointment, please visit our scheduling page or contact our office.

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: input.fromEmail,
    subject: "Appointment Cancelled",
    html,
    text,
  };
}

export interface RescheduleEmailInput {
  recipientEmail: string;
  firstName: string;
  confirmationCode: string;
  newDate: string;
  newTime: string;
  officeName: string;
  fromEmail: string;
}

export function buildRescheduleEmail(input: RescheduleEmailInput): EmailInput {
  const name = escapeHtml(input.firstName);
  const code = escapeHtml(input.confirmationCode);
  const date = escapeHtml(input.newDate);
  const time = escapeHtml(input.newTime);
  const office = escapeHtml(input.officeName);

  const html = `<p>Hi ${name},</p>
<p>Your appointment has been rescheduled:</p>
<ul>
  <li><strong>New Date:</strong> ${date}</li>
  <li><strong>New Time:</strong> ${time}</li>
  <li><strong>Location:</strong> ${office}</li>
  <li><strong>Confirmation Code:</strong> ${code}</li>
</ul>
<p>If you did not request this change, please contact our office.</p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

  const text = `Hi ${input.firstName},

Your appointment has been rescheduled:
- New Date: ${input.newDate}
- New Time: ${input.newTime}
- Location: ${input.officeName}
- Confirmation Code: ${input.confirmationCode}

If you did not request this change, please contact our office.

Thank you,
St. Lucie County Tax Collector`;

  return {
    to: input.recipientEmail,
    from: input.fromEmail,
    subject: "Appointment Rescheduled",
    html,
    text,
  };
}
