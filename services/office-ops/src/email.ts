import {
  SESv2Client,
  SendEmailCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
} from "@aws-sdk/client-sesv2";
import { escapeHtml } from "./utils.js";

// ─── SES Client ──────────────────────────────────────────────────────────────

/**
 * Create a SESv2Client. Callers that already manage their own client (e.g.
 * office-ops config.ts) can pass it to `sendEmail`; callers that don't (e.g.
 * chatbot) can use this factory or rely on the module-level default.
 */
export function createSesClient(region?: string): SESv2Client {
  return new SESv2Client({ region: region ?? process.env.AWS_REGION ?? "us-east-1" });
}

/** Module-level default client — lazy-initialized on first use. */
let _defaultClient: SESv2Client | undefined;
function getDefaultClient(): SESv2Client {
  if (!_defaultClient) _defaultClient = createSesClient();
  return _defaultClient;
}

// ─── sendEmail ───────────────────────────────────────────────────────────────

export interface EmailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send an email via SESv2. The `ses` parameter is optional — when omitted a
 * module-level default client is used (region from AWS_REGION env).
 */
export async function sendEmail(
  sesOrInput: SESv2Client | EmailInput,
  input?: EmailInput,
): Promise<void> {
  let client: SESv2Client;
  let email: EmailInput;

  if (input) {
    // Called as sendEmail(client, input)
    client = sesOrInput as SESv2Client;
    email = input;
  } else {
    // Called as sendEmail(input)
    client = getDefaultClient();
    email = sesOrInput as EmailInput;
  }

  await client.send(
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

// ─── Email Verification ──────────────────────────────────────────────────────

/**
 * Trigger SES email identity verification. Returns "already_verified" if the
 * identity is already verified, otherwise sends the verification email.
 */
export async function verifyEmailIdentity(
  email: string,
  ses?: SESv2Client,
): Promise<"verification_sent" | "already_verified"> {
  const client = ses ?? getDefaultClient();
  try {
    const result = await client.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    if (result.VerifiedForSendingStatus) return "already_verified";
  } catch {
    // Identity doesn't exist yet
  }
  try {
    await client.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "AlreadyExistsException") return "already_verified";
    throw err;
  }
  return "verification_sent";
}

/**
 * Check whether an email address is verified for sending in SES.
 */
export async function checkEmailVerified(email: string, ses?: SESv2Client): Promise<boolean> {
  const client = ses ?? getDefaultClient();
  try {
    const result = await client.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    return result.VerifiedForSendingStatus === true;
  } catch {
    return false;
  }
}

// ─── Date/Time Formatting ────────────────────────────────────────────────────

export interface FormattedDateTime {
  dateStr: string;
  timeStr: string;
}

/**
 * Format an appointment date (YYYY-MM-DD) and time (HH:MM or HH:MM:SS) into
 * human-readable strings suitable for emails.
 *
 * Example: "2026-08-10", "14:30" → "Monday, August 10, 2026", "2:30 PM"
 */
export function formatAppointmentDateTime(date: string, time: string): FormattedDateTime {
  const apptDate = new Date(date + "T00:00:00");
  const dateStr = apptDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  return { dateStr, timeStr };
}

// ─── Email Templates ─────────────────────────────────────────────────────────

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
