import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  uploadDocument,
  getRequiredDocsStatus,
  validateDocument,
} from "../../../services/office-ops/src/documents.js";
import { mockDb } from "./helpers/mock-db.js";

const BUCKET = "test-docs-bucket";
const FIXED_NOW = new Date("2026-05-12T14:30:00Z");

function mockS3() {
  const send = vi.fn().mockResolvedValue({});
  return { s3: { send } as unknown as S3Client, send };
}

describe("uploadDocument", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("uploads to S3 under an appointment-scoped key and records the document row", async () => {
    const { s3, send } = mockS3();
    const db = mockDb([{ rows: [{ id: 4242 }] }]);
    const fileBuffer = Buffer.from("fake-image-bytes");

    const result = await uploadDocument(s3, BUCKET, db, {
      appointmentId: 501,
      docId: "photo_id",
      name: "drivers_license.jpg",
      fileBuffer,
      contentType: "image/jpeg",
      aiReviewStatus: "accept",
      aiReviewNotes: "Document verified by AI",
    });

    const expectedKey = `appointments/501/${FIXED_NOW.getTime()}_drivers_license.jpg`;
    expect(result).toEqual({ documentId: 4242, s3Key: expectedKey });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: BUCKET,
      Key: expectedKey,
      Body: fileBuffer,
      ContentType: "image/jpeg",
    });

    expect(db.calls[0].values).toEqual([
      501,
      "photo_id",
      "drivers_license.jpg",
      expectedKey,
      "accept",
      "Document verified by AI",
    ]);
  });

  test("sanitizes unsafe characters out of the object key", async () => {
    const { s3, send } = mockS3();
    const db = mockDb([{ rows: [{ id: 1 }] }]);

    const { s3Key } = await uploadDocument(s3, BUCKET, db, {
      appointmentId: 7,
      docId: null,
      name: "my scan (front)/../secret.pdf",
      fileBuffer: Buffer.from("x"),
      contentType: "application/pdf",
    });

    expect(s3Key).toBe(`appointments/7/${FIXED_NOW.getTime()}_my_scan__front__.._secret.pdf`);
    // Path separators are stripped, so the key stays inside the appointment prefix.
    expect(s3Key.split("/")).toHaveLength(3);
    expect(send.mock.calls[0][0].input.Key).toBe(s3Key);
  });

  test("defaults AI review fields to null when omitted (clerk desk scan)", async () => {
    const { s3 } = mockS3();
    const db = mockDb([{ rows: [{ id: 9 }] }]);

    await uploadDocument(s3, BUCKET, db, {
      appointmentId: 12,
      docId: null,
      name: "walk_in_id.jpg",
      fileBuffer: Buffer.from("x"),
      contentType: "image/jpeg",
    });

    expect(db.calls[0].values).toEqual([
      12,
      null,
      "walk_in_id.jpg",
      `appointments/12/${FIXED_NOW.getTime()}_walk_in_id.jpg`,
      null,
      null,
    ]);
  });

  test("propagates S3 failures without writing a document row", async () => {
    const { s3, send } = mockS3();
    send.mockRejectedValueOnce(new Error("AccessDenied"));
    const db = mockDb([{ rows: [{ id: 1 }] }]);

    await expect(
      uploadDocument(s3, BUCKET, db, {
        appointmentId: 3,
        docId: "photo_id",
        name: "a.jpg",
        fileBuffer: Buffer.from("x"),
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow("AccessDenied");

    expect(db.calls).toHaveLength(0);
  });
});

describe("getRequiredDocsStatus", () => {
  test("returns one camelCased status row per required document", async () => {
    const db = mockDb([
      {
        rows: [
          {
            id: 1,
            doc_id: "photo_id",
            name: "Photo ID",
            uploaded: true,
            s3_key: "appointments/1/photo.jpg",
            ai_review_status: "reject",
            ai_review_notes: "blurry",
            clerk_validated: false,
          },
          {
            id: null,
            doc_id: "proof_address",
            name: "Proof of Address",
            uploaded: false,
            s3_key: null,
            ai_review_status: null,
            ai_review_notes: null,
            clerk_validated: false,
          },
        ],
      },
    ]);

    const docs = await getRequiredDocsStatus(db, 1);

    expect(docs).toEqual([
      {
        id: 1,
        docId: "photo_id",
        name: "Photo ID",
        uploaded: true,
        s3Key: "appointments/1/photo.jpg",
        aiReviewStatus: "reject",
        aiReviewNotes: "blurry",
        clerkValidated: false,
      },
      {
        id: null,
        docId: "proof_address",
        name: "Proof of Address",
        uploaded: false,
        s3Key: null,
        aiReviewStatus: null,
        aiReviewNotes: null,
        clerkValidated: false,
      },
    ]);
    expect(db.calls[0].values).toEqual([1]);
  });

  test("returns an empty list when the appointment requires no documents", async () => {
    const db = mockDb([{ rows: [] }]);
    await expect(getRequiredDocsStatus(db, 99)).resolves.toEqual([]);
  });
});

describe("validateDocument", () => {
  test("marks the document clerk-validated", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await validateDocument(db, 55);

    expect(db.calls[0].sql).toContain("clerk_validated = TRUE");
    expect(db.calls[0].values).toEqual([55]);
  });

  test("throws when the document does not exist", async () => {
    const db = mockDb([{ rowCount: 0 }]);
    await expect(validateDocument(db, 55)).rejects.toThrow("Document 55 not found");
  });
});
