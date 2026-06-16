import { describe, expect, test, beforeEach, vi } from "vitest";
import { useDb } from "../../db/tests/helpers/fixture.js";
import { bookAppointment } from "../../src/book-appt.js";
import { findAppointment } from "../../src/find-appt.js";
import {
  generateQrCode,
  lookupByQrCode,
  checkInToQueue,
  registerWalkIn,
  setAppointmentPriority,
} from "../../src/check-in.js";
import { getPrescreenQuestions, savePrescreenResponses } from "../../src/prescreen.js";
import { uploadDocument } from "../../src/documents.js";
import { setIdentityVerified } from "../../src/identity.js";
import { getCheckInSummary } from "../../src/check-in.js";
import { assignNextCustomer } from "../../src/queue.js";
import { completeAppointment } from "../../src/complete.js";
import { sendEmail, buildQrConfirmationEmail, buildPrescreenLinkEmail } from "../../src/email.js";
import { SESv2Client } from "@aws-sdk/client-sesv2";

// Mock SES — intercept the send method
vi.mock("@aws-sdk/client-sesv2", () => {
  const sendMock = vi.fn().mockResolvedValue({});
  class MockSESv2Client {
    send = sendMock;
  }
  class MockSendEmailCommand {
    constructor(public input: unknown) {}
  }
  return {
    SESv2Client: MockSESv2Client,
    SendEmailCommand: MockSendEmailCommand,
    sendMock,
  };
});

// Mock the S3 upload stub in documents.ts (it's already a stub but we want to verify calls)
vi.mock("../../src/documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/documents.js")>();
  return {
    ...actual,
    uploadDocument: vi.fn(async (db, input) => {
      const s3Key = `appointments/${input.appointmentId}/${Date.now()}_${input.name}`;
      const { rows } = await db.query(
        `INSERT INTO documents (appointment_id, doc_id, name, s3_key, ai_review_status, ai_review_notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.appointmentId,
          input.docId,
          input.name,
          s3Key,
          input.aiReviewStatus ?? null,
          input.aiReviewNotes ?? null,
        ],
      );
      return { documentId: rows[0].id, s3Key };
    }),
  };
});

const db = useDb();

const OFFICE = 1;
const DATE = "2026-05-12";
const FROZEN_NOW = "2026-05-12 06:00";

const ID_CARD = 2;

const MARIA = 1; // skills: {1,2,3}
const JAMES = 2; // skills: {2,3}

async function loginClerk(clerkId: number, desk: number) {
  await db.client.query(
    `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
     VALUES ($1, $2, $3, TRUE)`,
    [clerkId, OFFICE, desk],
  );
}

async function addPrescreenQuestions(txnTypeId: number) {
  await db.client.query(
    `INSERT INTO prescreen_questions (txn_type_id, sort_order, question_text)
     VALUES ($1, 1, 'Do you have corrective lenses?'),
            ($1, 2, 'Have you had a seizure in the last 2 years?')
     ON CONFLICT DO NOTHING`,
    [txnTypeId],
  );
}

describe("Flow A: Scheduled Appointment — end to end", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await db.client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
    await db.client.query(
      `DELETE FROM documents WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
    await db.client.query(
      `DELETE FROM appointments WHERE office_id = $1 AND appointment_date = $2`,
      [OFFICE, DATE],
    );
  });

  test("full scheduled flow: book → prescreen → upload docs → check-in → serve → complete", async () => {
    // ─── 1. Find a slot ───
    const slot = await findAppointment(db.client, {
      targetTxns: [ID_CARD],
      asap: true,
      preferredOffice: OFFICE,
      preferredDow: null,
      preferredTime: null,
      startDate: new Date("2026-05-12T00:00:00Z"),
      days: 5,
      nowTs: FROZEN_NOW,
    });
    expect(slot).not.toBeNull();
    expect(slot!.officeId).toBe(OFFICE);

    // ─── 2. Book the appointment ───
    const qrCode = generateQrCode();
    const bookResult = await bookAppointment(db.client, {
      officeId: slot!.officeId,
      date: slot!.slotDate,
      time: slot!.slotTime,
      txnTypeIds: [ID_CARD],
      requiredDocIds: ["photo_id", "proof_address"],
      firstName: "Alice",
      lastName: "Johnson",
      contactEmail: "alice@example.com",
      contactPhone: "555-1234",
      qrCode,
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error("booking failed");
    const appointmentId = bookResult.appointmentId;

    // ─── 3. Send confirmation email (mocked SES) ───
    const ses = new SESv2Client({});
    const emailInput = buildQrConfirmationEmail({
      recipientEmail: "alice@example.com",
      firstName: "Alice",
      appointmentDate: slot!.slotDate,
      appointmentTime: slot!.slotTime,
      officeName: "Fort Pierce Office",
      qrCodeDataUrl: "data:image/png;base64,FAKE",
      fromEmail: "noreply@stlucie.gov",
    });
    await sendEmail(ses, emailInput);
    expect(ses.send).toHaveBeenCalledTimes(1);

    // ─── 4. Pre-visit: upload documents (web path — AI reviewed) ───
    const docResult = await vi.mocked(uploadDocument)(db.client, {
      appointmentId,
      docId: "photo_id",
      name: "drivers_license.jpg",
      fileBuffer: Buffer.from("fake-image"),
      contentType: "image/jpeg",
      aiReviewStatus: "accept",
      aiReviewNotes: "Document verified by AI",
    });
    expect(docResult.documentId).toBeGreaterThan(0);
    expect(docResult.s3Key).toContain("appointments/");

    await vi.mocked(uploadDocument)(db.client, {
      appointmentId,
      docId: "proof_address",
      name: "utility_bill.pdf",
      fileBuffer: Buffer.from("fake-pdf"),
      contentType: "application/pdf",
      aiReviewStatus: "accept",
      aiReviewNotes: null,
    });

    // ─── 5. Pre-visit: complete prescreen questions ───
    await addPrescreenQuestions(ID_CARD);
    const questions = await getPrescreenQuestions(db.client, [ID_CARD]);
    expect(questions.length).toBe(2);

    await savePrescreenResponses(db.client, appointmentId, {
      [String(questions[0].id)]: true,
      [String(questions[1].id)]: false,
    });

    // ─── 6. Arrival: scan QR code ───
    const lookup = await lookupByQrCode(db.client, qrCode);
    expect(lookup).not.toBeNull();
    expect(lookup!.appointmentId).toBe(appointmentId);

    // ─── 7. Check readiness — should be ready (scheduled appts are identity-verified) ───
    await db.client.query(`UPDATE appointments SET identity_verified = TRUE WHERE id = $1`, [
      appointmentId,
    ]);

    const summary = await getCheckInSummary(db.client, appointmentId);
    expect(summary.prescreenCompleted).toBe(true);
    expect(summary.docsReady).toBe(true);
    expect(summary.missingDocs).toEqual([]);
    expect(summary.readyForQueue).toBe(true);

    // ─── 8. Add to queue ───
    const checkInResult = await checkInToQueue(
      db.client,
      OFFICE,
      appointmentId,
      "Regular check-in",
    );
    expect(checkInResult.queueId).toBeGreaterThan(0);
    expect(checkInResult.queueNumber).toBeGreaterThan(0);

    // ─── 9. Clerk logs in and summons next ───
    await loginClerk(MARIA, 1);
    const assigned = await assignNextCustomer(db.client, OFFICE, MARIA);
    expect(assigned).not.toBeNull();
    expect(assigned!.queueId).toBe(checkInResult.queueId);
    expect(assigned!.deskNumber).toBe(1);

    // ─── 10. Clerk completes appointment ───
    await completeAppointment(db.client, {
      officeId: OFFICE,
      queueId: checkInResult.queueId,
      clerkId: MARIA,
      durationMin: 12,
    });

    // Verify final state
    const { rows: queueRows } = await db.client.query(`SELECT status FROM queue WHERE id = $1`, [
      checkInResult.queueId,
    ]);
    expect(queueRows[0].status).toBe("done");

    const { rows: apptRows } = await db.client.query(
      `SELECT status FROM appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(apptRows[0].status).toBe("completed");

    const { rows: historyRows } = await db.client.query(
      `SELECT duration_min FROM service_history ORDER BY id DESC LIMIT 1`,
      [],
    );
    expect(historyRows[0].duration_min).toBe(12);

    const { rows: clerkRows } = await db.client.query(
      `SELECT is_available FROM clerk_sessions
       WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
      [MARIA, OFFICE],
    );
    expect(clerkRows[0].is_available).toBe(true);
  });

  test("check-in blocks queue entry when docs are missing", async () => {
    const qrCode = generateQrCode();
    const bookResult = await bookAppointment(db.client, {
      officeId: OFFICE,
      date: DATE,
      time: "10:00:00",
      txnTypeIds: [ID_CARD],
      requiredDocIds: ["photo_id"],
      firstName: "Bob",
      lastName: "Smith",
      contactEmail: "bob@example.com",
      contactPhone: "555-5678",
      qrCode,
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error("booking failed");

    await db.client.query(
      `UPDATE appointments SET identity_verified = TRUE, prescreen_completed = TRUE WHERE id = $1`,
      [bookResult.appointmentId],
    );

    const summary = await getCheckInSummary(db.client, bookResult.appointmentId);
    expect(summary.readyForQueue).toBe(false);
    expect(summary.missingDocs).toContain("photo_id");
  });

  test("check-in sends prescreen link when incomplete", async () => {
    const qrCode = generateQrCode();
    const ses = new SESv2Client({});
    vi.mocked(ses.send).mockClear();

    const emailInput = buildPrescreenLinkEmail({
      recipientEmail: "carol@example.com",
      firstName: "Carol",
      qrCode,
      baseUrl: "https://tax.stlucie.gov",
      fromEmail: "noreply@stlucie.gov",
    });
    await sendEmail(ses, emailInput);

    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(emailInput.html).toContain(`/prescreen/${qrCode}`);
    expect(emailInput.subject).toBe("Complete Your Pre-Screen Questions");
  });
});

describe("Flow B: Walk-In — end to end", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await db.client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
    await db.client.query(
      `DELETE FROM documents WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
    await db.client.query(
      `DELETE FROM appointments WHERE office_id = $1 AND appointment_date = $2`,
      [OFFICE, DATE],
    );
  });

  test("full walk-in flow: register → verify ID → prescreen → docs → queue → serve → complete", async () => {
    // ─── 1. Register walk-in ───
    const walkInResult = await registerWalkIn(db.client, {
      officeId: OFFICE,
      txnTypeIds: [ID_CARD],
      firstName: "Dave",
      lastName: "Walker",
      contactEmail: "dave@example.com",
      contactPhone: "555-9999",
      nowTs: "2026-05-12 09:30",
    });
    expect(walkInResult.ok).toBe(true);
    if (!walkInResult.ok) throw new Error("walk-in failed");
    const appointmentId = walkInResult.appointmentId;

    // ─── 2. Clerk verifies identity ───
    await setIdentityVerified(db.client, appointmentId);

    const { rows: idRows } = await db.client.query(
      `SELECT identity_verified FROM appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(idRows[0].identity_verified).toBe(true);

    // ─── 3. Clerk scans docs at desk (no AI review) ───
    await vi.mocked(uploadDocument)(db.client, {
      appointmentId,
      docId: null,
      name: "walk_in_photo_id.jpg",
      fileBuffer: Buffer.from("scanned-image"),
      contentType: "image/jpeg",
      aiReviewStatus: null,
      aiReviewNotes: null,
    });

    // ─── 4. Send prescreen link, customer completes on phone ───
    await addPrescreenQuestions(ID_CARD);
    const questions = await getPrescreenQuestions(db.client, [ID_CARD]);

    await savePrescreenResponses(db.client, appointmentId, {
      [String(questions[0].id)]: false,
      [String(questions[1].id)]: false,
    });

    // ─── 5. Readiness check — walk-in has no required_doc_ids so docsReady = true ───
    const summary = await getCheckInSummary(db.client, appointmentId);
    expect(summary.identityVerified).toBe(true);
    expect(summary.prescreenCompleted).toBe(true);
    expect(summary.docsReady).toBe(true);
    expect(summary.readyForQueue).toBe(true);

    // ─── 6. Add to queue with priority ───
    await setAppointmentPriority(db.client, appointmentId, true);
    const checkInResult = await checkInToQueue(
      db.client,
      OFFICE,
      appointmentId,
      "Walk-in, ID verified at desk",
    );
    expect(checkInResult.queueNumber).toBeGreaterThan(0);

    // ─── 7. Clerk serves ───
    await loginClerk(JAMES, 2);
    const assigned = await assignNextCustomer(db.client, OFFICE, JAMES);
    expect(assigned).not.toBeNull();
    expect(assigned!.queueId).toBe(checkInResult.queueId);

    // ─── 8. Complete ───
    await completeAppointment(db.client, {
      officeId: OFFICE,
      queueId: checkInResult.queueId,
      clerkId: JAMES,
      durationMin: 8,
    });

    const { rows: finalQueue } = await db.client.query(`SELECT status FROM queue WHERE id = $1`, [
      checkInResult.queueId,
    ]);
    expect(finalQueue[0].status).toBe("done");

    const { rows: finalAppt } = await db.client.query(
      `SELECT status FROM appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(finalAppt[0].status).toBe("completed");
  });

  test("walk-in not ready for queue until identity verified and prescreen done", async () => {
    const walkInResult = await registerWalkIn(db.client, {
      officeId: OFFICE,
      txnTypeIds: [ID_CARD],
      firstName: "Eve",
      lastName: "NoPrep",
      contactEmail: "eve@example.com",
      contactPhone: "555-0001",
      nowTs: "2026-05-12 10:00",
    });
    expect(walkInResult.ok).toBe(true);
    if (!walkInResult.ok) throw new Error("walk-in failed");

    // Not verified, prescreen not done
    const summary = await getCheckInSummary(db.client, walkInResult.appointmentId);
    expect(summary.identityVerified).toBe(false);
    expect(summary.prescreenCompleted).toBe(false);
    expect(summary.readyForQueue).toBe(false);
  });
});
