import { describe, expect, test } from "vitest";
import {
  buildQrConfirmationEmail,
  formatAppointmentDateTime,
} from "../../../services/office-ops/src/email.js";

describe("confirmation email (shared)", () => {
  test("includes queue-status and manage/reschedule links", () => {
    const email = buildQrConfirmationEmail({
      recipientEmail: "alice@example.com",
      firstName: "Alice",
      confirmationCode: "ABC123",
      appointmentDate: "Tuesday, May 12, 2026",
      appointmentTime: "9:00 AM",
      officeName: "Fort Pierce Office",
      qrCodeDataUrl: "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=ABC123",
      baseUrl: "https://tax.example.gov",
      fromEmail: "noreply@tax.example.gov",
    });

    // Queue-status link
    expect(email.html).toContain("https://tax.example.gov/queue-status/ABC123");
    expect(email.text).toContain("https://tax.example.gov/queue-status/ABC123");

    // Manage/reschedule link
    expect(email.html).toContain("https://tax.example.gov/manage/ABC123");
    expect(email.text).toContain("https://tax.example.gov/manage/ABC123");

    // Core info
    expect(email.html).toContain("ABC123");
    expect(email.html).toContain("Fort Pierce Office");
    expect(email.html).toContain("Tuesday, May 12, 2026");
    expect(email.html).toContain("9:00 AM");

    // QR code
    expect(email.html).toContain("QR Code");

    // Envelope
    expect(email.to).toBe("alice@example.com");
    expect(email.from).toBe("noreply@tax.example.gov");
    expect(email.subject).toBe("Appointment Confirmed");
  });
});

describe("formatAppointmentDateTime", () => {
  test("formats date and time correctly", () => {
    const { dateStr, timeStr } = formatAppointmentDateTime("2026-08-10", "14:30");
    expect(dateStr).toBe("Monday, August 10, 2026");
    expect(timeStr).toBe("2:30 PM");
  });

  test("handles noon correctly", () => {
    const { timeStr } = formatAppointmentDateTime("2026-01-01", "12:00");
    expect(timeStr).toBe("12:00 PM");
  });

  test("handles midnight correctly", () => {
    const { timeStr } = formatAppointmentDateTime("2026-01-01", "00:15");
    expect(timeStr).toBe("12:15 AM");
  });
});
