import { describe, expect, test, vi } from "vitest";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  sendEmail,
  buildQrConfirmationEmail,
  buildQueueSummonEmail,
  buildPrescreenLinkEmail,
} from "../../../services/office-ops/src/email.js";

const FROM = "noreply@stlucie.gov";

describe("sendEmail", () => {
  test("sends a simple multipart message through SES", async () => {
    const send = vi.fn().mockResolvedValue({});
    const ses = { send } as unknown as SESv2Client;

    await sendEmail(ses, {
      to: "alice@example.com",
      from: FROM,
      subject: "Appointment Confirmed",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: ["alice@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Appointment Confirmed" },
          Body: {
            Html: { Data: "<p>hi</p>" },
            Text: { Data: "hi" },
          },
        },
      },
    });
  });

  test("propagates SES failures to the caller", async () => {
    const ses = {
      send: vi.fn().mockRejectedValue(new Error("MessageRejected")),
    } as unknown as SESv2Client;

    await expect(
      sendEmail(ses, { to: "a@b.c", from: FROM, subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow("MessageRejected");
  });
});

describe("buildQrConfirmationEmail", () => {
  test("includes appointment details, the QR image, and addressing metadata", () => {
    const email = buildQrConfirmationEmail({
      recipientEmail: "alice@example.com",
      firstName: "Alice",
      confirmationCode: "ABC123",
      appointmentDate: "2026-05-12",
      appointmentTime: "09:00:00",
      officeName: "Fort Pierce Office",
      qrCodeDataUrl: "data:image/png;base64,FAKE",
      baseUrl: "https://example.com",
      fromEmail: FROM,
    });

    expect(email.to).toBe("alice@example.com");
    expect(email.from).toBe(FROM);
    expect(email.subject).toBe("Appointment Confirmed");
    expect(email.html).toContain("ABC123");
    expect(email.html).toContain("2026-05-12");
    expect(email.html).toContain("Fort Pierce Office");
    expect(email.html).toContain('<img src="data:image/png;base64,FAKE"');
    expect(email.text).toContain("Confirmation Code: ABC123");
    expect(email.text).toContain("Location: Fort Pierce Office");
    expect(email.html).toContain("https://example.com/queue-status/ABC123");
    expect(email.text).toContain("https://example.com/queue-status/ABC123");
  });

  test("escapes HTML in customer-supplied values", () => {
    const email = buildQrConfirmationEmail({
      recipientEmail: "alice@example.com",
      firstName: '<script>alert("x")</script>',
      confirmationCode: "A&B",
      appointmentDate: "2026-05-12",
      appointmentTime: "09:00:00",
      officeName: "Fort <Pierce>",
      qrCodeDataUrl: "data:image/png;base64,FAKE",
      baseUrl: "https://example.com",
      fromEmail: FROM,
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("A&amp;B");
    expect(email.html).toContain("Fort &lt;Pierce&gt;");
    // Plain-text part stays unescaped.
    expect(email.text).toContain('<script>alert("x")</script>');
    // Queue-status link uses the raw (unescaped) confirmation code in the URL
    expect(email.text).toContain("https://example.com/queue-status/A&B");
  });
});

describe("buildQueueSummonEmail", () => {
  test("names the desk in the subject and both bodies", () => {
    const email = buildQueueSummonEmail({
      recipientEmail: "bob@example.com",
      firstName: "Bob",
      confirmationCode: "XYZ789",
      deskNumber: 4,
      officeName: "Tradition Office",
      fromEmail: FROM,
    });

    expect(email.to).toBe("bob@example.com");
    expect(email.from).toBe(FROM);
    expect(email.subject).toBe("It's Your Turn — Desk 4");
    expect(email.html).toContain("<strong>Desk 4</strong>");
    expect(email.html).toContain("Tradition Office");
    expect(email.html).toContain("XYZ789");
    expect(email.text).toContain("proceed to Desk 4 at Tradition Office");
    expect(email.text).toContain("Your confirmation code: XYZ789");
  });

  test("escapes HTML in customer-supplied values", () => {
    const email = buildQueueSummonEmail({
      recipientEmail: "bob@example.com",
      firstName: "<b>Bob</b>",
      confirmationCode: 'X"Y',
      deskNumber: 1,
      officeName: "A & B",
      fromEmail: FROM,
    });

    expect(email.html).toContain("&lt;b&gt;Bob&lt;/b&gt;");
    expect(email.html).toContain("&quot;");
    expect(email.html).toContain("A &amp; B");
  });
});

describe("buildPrescreenLinkEmail", () => {
  test("builds a prescreen deep link from the base URL and confirmation code", () => {
    const email = buildPrescreenLinkEmail({
      recipientEmail: "carol@example.com",
      firstName: "Carol",
      confirmationCode: "TEST1234",
      baseUrl: "https://tax.stlucie.gov",
      fromEmail: FROM,
    });

    expect(email.subject).toBe("Complete Your Pre-Screen Questions");
    expect(email.html).toContain('href="https://tax.stlucie.gov/prescreen/TEST1234"');
    expect(email.text).toContain("https://tax.stlucie.gov/prescreen/TEST1234");
  });

  test("escapes the link and name in the HTML body", () => {
    const email = buildPrescreenLinkEmail({
      recipientEmail: "carol@example.com",
      firstName: "Carol & Co",
      confirmationCode: 'A"B',
      baseUrl: "https://tax.stlucie.gov",
      fromEmail: FROM,
    });

    expect(email.html).toContain("Carol &amp; Co");
    expect(email.html).not.toContain('/prescreen/A"B"');
    expect(email.html).toContain("/prescreen/A&quot;B");
    expect(email.text).toContain('/prescreen/A"B');
  });
});
