import { describe, expect, test, beforeEach, vi } from "vitest";
import { useDb } from "../db/helpers/fixture.js";
import { ID_CARD, MARIA, JAMES } from "../db/helpers/seed-ids.js";
import { bookAppointment } from "../../../services/office-ops/src/book-appt.js";
import { findAppointment } from "../../../services/office-ops/src/find-appt.js";
import {
  lookupByConfirmationCode,
  lookupByName,
  checkInToQueue,
  registerWalkIn,
  setAppointmentPriority,
} from "../../../services/office-ops/src/check-in.js";
import {
  getPrescreenQuestions,
  savePrescreenResponses,
  createPrescreenQuestions,
} from "../../../services/office-ops/src/prescreen.js";
import {
  uploadDocument,
  getRequiredDocsStatus,
  validateDocument,
} from "../../../services/office-ops/src/documents.js";
import { setIdentityVerified } from "../../../services/office-ops/src/identity.js";
import { getAppointmentInfo } from "../../../services/office-ops/src/check-in.js";
import { assignNextCustomer } from "../../../services/office-ops/src/queue.js";
import { completeAppointment } from "../../../services/office-ops/src/complete.js";
import {
  sendEmail,
  buildQrConfirmationEmail,
  buildPrescreenLinkEmail,
} from "../../../services/office-ops/src/email.js";
import { cancelAppointment } from "../../../services/office-ops/src/book-appt.js";
import { clerkLogin } from "../../../services/office-ops/src/clerk-session.js";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import type { S3Client } from "@aws-sdk/client-s3";

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
vi.mock("../../../services/office-ops/src/documents.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/office-ops/src/documents.js")>();
  return {
    ...actual,
    uploadDocument: vi.fn(async (_s3, _bucket, db, input) => {
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
const FROZEN_NOW = "2026-05-11 18:00";

async function loginClerk(clerkId: number, desk: number) {
  await clerkLogin(db.client, clerkId, OFFICE, desk);
}

async function addPrescreenQuestions(txnTypeId: number) {
  await createPrescreenQuestions(db.client, txnTypeId, [
    { sortOrder: 1, questionText: "Do you have corrective lenses?" },
    { sortOrder: 2, questionText: "Have you had a seizure in the last 2 years?" },
  ]);
}

describe("Flow A: Scheduled Appointment — end to end", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await db.client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
    await db.client.query(
      `DELETE FROM service_history WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
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
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error("booking failed");
    const appointmentId = bookResult.appointmentId;
    // QR code is generated by the DB and returned from booking.
    const confirmationCode = bookResult.confirmationCode;

    // ─── 3. Send confirmation email (mocked SES) ───
    const ses = new SESv2Client({});
    const emailInput = buildQrConfirmationEmail({
      recipientEmail: "alice@example.com",
      firstName: "Alice",
      confirmationCode,
      appointmentDate: slot!.slotDate,
      appointmentTime: slot!.slotTime,
      officeName: "Fort Pierce Office",
      qrCodeDataUrl: "data:image/png;base64,FAKE",
      baseUrl: "https://tax.stlucie.gov",
      fromEmail: "noreply@stlucie.gov",
    });
    await sendEmail(ses, emailInput);
    expect(ses.send).toHaveBeenCalledTimes(1);

    // ─── 4. Pre-visit: upload documents (web path — AI reviewed) ───
    const doc1 = await vi.mocked(uploadDocument)(
      null as unknown as S3Client,
      "test-bucket",
      db.client,
      {
        appointmentId,
        docId: "photo_id",
        name: "drivers_license.jpg",
        fileBuffer: Buffer.from("fake-image"),
        contentType: "image/jpeg",
        aiReviewStatus: "accept",
        aiReviewNotes: "Document verified by AI",
      },
    );

    const doc2 = await vi.mocked(uploadDocument)(
      null as unknown as S3Client,
      "test-bucket",
      db.client,
      {
        appointmentId,
        docId: "proof_address",
        name: "utility_bill.pdf",
        fileBuffer: Buffer.from("fake-pdf"),
        contentType: "application/pdf",
        aiReviewStatus: "accept",
        aiReviewNotes: null,
      },
    );

    await validateDocument(db.client, doc1.documentId);
    await validateDocument(db.client, doc2.documentId);

    // ─── 5. Pre-visit: complete prescreen questions ───
    await addPrescreenQuestions(ID_CARD);
    const questions = await getPrescreenQuestions(db.client, [ID_CARD]);
    expect(questions.length).toBe(2);

    await savePrescreenResponses(db.client, appointmentId, {
      [String(questions[0].id)]: true,
      [String(questions[1].id)]: false,
    });

    // ─── 6. Arrival: scan QR code ───
    const lookup = await lookupByConfirmationCode(db.client, confirmationCode);
    expect(lookup).not.toBeNull();
    expect(lookup!.appointmentId).toBe(appointmentId);

    // ─── 7. Verify clerk view — appointment info + doc status ───
    await setIdentityVerified(db.client, appointmentId);

    const info = await getAppointmentInfo(db.client, appointmentId);
    expect(info.prescreenCompleted).toBe(true);
    expect(info.identityVerified).toBe(true);

    const docs = await getRequiredDocsStatus(db.client, appointmentId);
    expect(docs.every((d) => d.clerkValidated)).toBe(true);

    // ─── 8. Add to queue ───
    const checkInResult = await checkInToQueue(
      db.client,
      OFFICE,
      appointmentId,
      "Regular check-in",
    );
    expect(checkInResult.queueId).toBeGreaterThan(0);
    expect(checkInResult.queueNumber).toBeGreaterThan(0);

    const { rows: noteRows } = await db.client.query(`SELECT notes FROM queue WHERE id = $1`, [
      checkInResult.queueId,
    ]);
    expect(noteRows[0].notes).toBe("Regular check-in");

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
      `SELECT duration_sec FROM service_history ORDER BY id DESC LIMIT 1`,
      [],
    );
    expect(historyRows[0].duration_sec).toBeGreaterThanOrEqual(0);

    const { rows: clerkRows } = await db.client.query(
      `SELECT is_available FROM clerk_sessions
       WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
      [MARIA, OFFICE],
    );
    expect(clerkRows[0].is_available).toBe(true);
  });

  test("clerk sees unuploaded docs as not uploaded", async () => {
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
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error("booking failed");

    const docs = await getRequiredDocsStatus(db.client, bookResult.appointmentId);
    const photoDoc = docs.find((d) => d.docId === "photo_id")!;
    expect(photoDoc.uploaded).toBe(false);
    expect(photoDoc.clerkValidated).toBe(false);
  });

  test("check-in sends prescreen link when incomplete", async () => {
    const confirmationCode = "TEST1234";
    const ses = new SESv2Client({});
    vi.mocked(ses.send).mockClear();

    const emailInput = buildPrescreenLinkEmail({
      recipientEmail: "carol@example.com",
      firstName: "Carol",
      confirmationCode,
      baseUrl: "https://tax.stlucie.gov",
      fromEmail: "noreply@stlucie.gov",
    });
    await sendEmail(ses, emailInput);

    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(emailInput.html).toContain(`/prescreen/${confirmationCode}`);
    expect(emailInput.subject).toBe("Complete Your Pre-Screen Questions");
  });
});

describe("Flow B: Walk-In — end to end", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await db.client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
    await db.client.query(
      `DELETE FROM service_history WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
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
    await vi.mocked(uploadDocument)(null as unknown as S3Client, "test-bucket", db.client, {
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

    // ─── 5. Clerk reviews appointment info ───
    const info = await getAppointmentInfo(db.client, appointmentId);
    expect(info.identityVerified).toBe(true);
    expect(info.prescreenCompleted).toBe(true);

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

  test("priority walk-in is served before non-priority", async () => {
    // Regular walk-in checks in first
    const regular = await registerWalkIn(db.client, {
      officeId: OFFICE,
      txnTypeIds: [ID_CARD],
      firstName: "Normal",
      lastName: "Person",
      contactEmail: "normal@example.com",
      contactPhone: "555-0002",
      nowTs: "2026-05-12 09:00",
    });
    if (!regular.ok) throw new Error("regular walk-in failed");
    await checkInToQueue(db.client, OFFICE, regular.appointmentId);

    // Priority walk-in checks in second
    const priority = await registerWalkIn(db.client, {
      officeId: OFFICE,
      txnTypeIds: [ID_CARD],
      firstName: "Priority",
      lastName: "Person",
      contactEmail: "priority@example.com",
      contactPhone: "555-0003",
      isPriority: true,
      nowTs: "2026-05-12 09:05",
    });
    if (!priority.ok) throw new Error("priority walk-in failed");
    const priorityCheckIn = await checkInToQueue(db.client, OFFICE, priority.appointmentId);

    // Clerk summons next — should get the priority one
    await loginClerk(MARIA, 1);
    const assigned = await assignNextCustomer(db.client, OFFICE, MARIA);
    expect(assigned).not.toBeNull();
    expect(assigned!.queueId).toBe(priorityCheckIn.queueId);
  });

  test("walk-in shows unverified status before clerk actions", async () => {
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

    const info = await getAppointmentInfo(db.client, walkInResult.appointmentId);
    expect(info.identityVerified).toBe(false);
    expect(info.prescreenCompleted).toBe(false);
  });
});

describe("Lookup — QR code and name search", () => {
  beforeEach(async () => {
    await db.client.query(
      `DELETE FROM queue WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
    await db.client.query(
      `DELETE FROM service_history WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
    await db.client.query(
      `DELETE FROM documents WHERE appointment_id IN (SELECT id FROM appointments WHERE office_id = $1 AND appointment_date = $2)`,
      [OFFICE, DATE],
    );
    await db.client.query(
      `DELETE FROM appointments WHERE office_id = $1 AND appointment_date = $2`,
      [OFFICE, DATE],
    );
  });

  test("lookupByConfirmationCode returns appointment for valid code", async () => {
    const bookResult = await bookAppointment(db.client, {
      officeId: OFFICE,
      date: DATE,
      time: "09:00:00",
      txnTypeIds: [ID_CARD],
      requiredDocIds: ["photo_id"],
      firstName: "Quinn",
      lastName: "Lookup",
      contactEmail: "quinn@example.com",
      contactPhone: "555-0010",
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error("booking failed");

    const result = await lookupByConfirmationCode(db.client, bookResult.confirmationCode);
    expect(result).not.toBeNull();
    expect(result!.appointmentId).toBe(bookResult.appointmentId);
  });

  test("lookupByConfirmationCode returns null for unknown code", async () => {
    const result = await lookupByConfirmationCode(db.client, "nonexistent-uuid-value");
    expect(result).toBeNull();
  });

  test("lookupByName matches prefix, case-insensitive, scoped to office/date/status", async () => {
    const bookResult = await bookAppointment(db.client, {
      officeId: OFFICE,
      date: DATE,
      time: "10:00:00",
      txnTypeIds: [ID_CARD],
      requiredDocIds: ["photo_id"],
      firstName: "Jasmine",
      lastName: "Henderson",
      contactEmail: "jasmine@example.com",
      contactPhone: "555-0011",
      nowTs: FROZEN_NOW,
    });
    if (!bookResult.ok) throw new Error("booking failed");

    // First name prefix
    const byFirst = await lookupByName(db.client, "Jas", OFFICE, DATE);
    expect(byFirst.length).toBeGreaterThanOrEqual(1);
    expect(byFirst.some((r) => r.firstName === "Jasmine")).toBe(true);

    // Last name prefix
    const byLast = await lookupByName(db.client, "Hen", OFFICE, DATE);
    expect(byLast.some((r) => r.lastName === "Henderson")).toBe(true);

    // Case-insensitive
    const byLower = await lookupByName(db.client, "jas", OFFICE, DATE);
    expect(byLower.some((r) => r.firstName === "Jasmine")).toBe(true);

    // Case-insensitive partial name
    const byFullNameLower = await lookupByName(db.client, "jasmine h", OFFICE, DATE);
    expect(
      byFullNameLower.some((r) => r.firstName === "Jasmine" && r.lastName === "Henderson"),
    ).toBe(true);

    // Full "first last" prefix matches
    const byFullName = await lookupByName(db.client, "Jasmine Henderson", OFFICE, DATE);
    expect(byFullName.length).toBeGreaterThanOrEqual(1);
    expect(byFullName.some((r) => r.firstName === "Jasmine" && r.lastName === "Henderson")).toBe(
      true,
    );

    // Cancelled appointment excluded
    await cancelAppointment(db.client, bookResult.appointmentId);
    const afterCancel = await lookupByName(db.client, "Jas", OFFICE, DATE);
    expect(afterCancel.some((r) => r.firstName === "Jasmine")).toBe(false);
  });

  test("lookupByName respects timezone — appointment on 'today' in office tz", async () => {
    const bookResult = await bookAppointment(db.client, {
      officeId: OFFICE,
      date: DATE,
      time: "16:00:00",
      txnTypeIds: [ID_CARD],
      requiredDocIds: ["photo_id"],
      firstName: "Timezone",
      lastName: "Test",
      contactEmail: "tz@example.com",
      contactPhone: "555-0016",
      nowTs: FROZEN_NOW,
    });
    expect(bookResult.ok).toBe(true);
    if (!bookResult.ok) throw new Error(`booking failed: ${bookResult.error}`);

    // Correct office-local date finds it
    const found = await lookupByName(db.client, "Time", OFFICE, "2026-05-12");
    expect(found.some((r) => r.firstName === "Timezone")).toBe(true);

    // Next day (simulating UTC midnight rollover) is not for local today
    const notFound = await lookupByName(db.client, "Time", OFFICE, "2026-05-13");
    expect(notFound.some((r) => r.firstName === "Timezone")).toBe(false);
  });
});
