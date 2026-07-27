import { describe, expect, test } from "vitest";
import {
  getClerkServiceRecord,
  sendToWrittenTest,
  completeWrittenTest,
} from "../../../services/office-ops/src/service-clerk.js";
import { mockDb } from "./helpers/mock-db.js";

const QUEUE_ID = 77;

function queueJoinRow(overrides: Record<string, unknown> = {}) {
  return {
    queue_id: QUEUE_ID,
    queue_number: 12,
    notes: "needs interpreter",
    steps: { identity: true, docs: false },
    appointment_id: 501,
    first_name: "Ana",
    last_name: "Reyes",
    contact_email: "ana@example.com",
    contact_phone: "555-0100",
    txn_type_ids: [3, 4],
    required_doc_ids: ["photo_id", "proof_address"],
    identity_verified: true,
    prescreen_completed: true,
    prescreen_responses: { "1": true },
    is_priority: false,
    ...overrides,
  };
}

describe("getClerkServiceRecord", () => {
  test("maps queue, appointment, transactions, and docs into a camelCase record", async () => {
    const db = mockDb([
      { rows: [queueJoinRow()] },
      {
        rows: [
          { id: 3, name: "Driver License Renewal" },
          { id: 4, name: "ID Card" },
        ],
      },
      {
        rows: [
          {
            doc_id: "photo_id",
            name: "Photo ID",
            uploaded: true,
            s3_key: "appointments/501/photo.jpg",
            ai_review_status: "accept",
            ai_review_notes: "looks good",
            clerk_validated: true,
          },
          {
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

    const record = await getClerkServiceRecord(db, QUEUE_ID);

    expect(record).toEqual({
      appointmentId: 501,
      queueId: QUEUE_ID,
      queueNumber: 12,
      firstName: "Ana",
      lastName: "Reyes",
      contactEmail: "ana@example.com",
      contactPhone: "555-0100",
      txnTypes: [
        { id: 3, name: "Driver License Renewal" },
        { id: 4, name: "ID Card" },
      ],
      identityVerified: true,
      prescreenCompleted: true,
      prescreenResponses: { "1": true },
      docs: [
        {
          docId: "photo_id",
          name: "Photo ID",
          uploaded: true,
          s3Key: "appointments/501/photo.jpg",
          aiReviewStatus: "accept",
          aiReviewNotes: "looks good",
          clerkValidated: true,
        },
        {
          docId: "proof_address",
          name: "Proof of Address",
          uploaded: false,
          s3Key: null,
          aiReviewStatus: null,
          aiReviewNotes: null,
          clerkValidated: false,
        },
      ],
      notes: "needs interpreter",
      isPriority: false,
      steps: { identity: true, docs: false },
    });

    // Doc query is scoped to the appointment and its required doc ids.
    expect(db.calls[2].values).toEqual([501, ["photo_id", "proof_address"]]);
  });

  test("skips the doc query when the appointment requires no documents", async () => {
    const db = mockDb([
      { rows: [queueJoinRow({ required_doc_ids: [] })] },
      { rows: [{ id: 3, name: "Driver License Renewal" }] },
    ]);

    const record = await getClerkServiceRecord(db, QUEUE_ID);

    expect(record.docs).toEqual([]);
    expect(db.calls).toHaveLength(2);
  });

  test("defaults null prescreen responses and steps to empty objects", async () => {
    const db = mockDb([
      { rows: [queueJoinRow({ required_doc_ids: [], prescreen_responses: null, steps: null })] },
      { rows: [] },
    ]);

    const record = await getClerkServiceRecord(db, QUEUE_ID);

    expect(record.prescreenResponses).toEqual({});
    expect(record.steps).toEqual({});
    expect(record.txnTypes).toEqual([]);
  });

  test("throws when the queue entry does not exist", async () => {
    const db = mockDb([{ rows: [] }]);
    await expect(getClerkServiceRecord(db, QUEUE_ID)).rejects.toThrow(
      `Queue entry ${QUEUE_ID} not found`,
    );
  });
});

const TEST_INPUT = {
  queueId: QUEUE_ID,
  testStationId: 9,
  clerkId: 10,
  officeId: 1,
};

describe("sendToWrittenTest", () => {
  test("moves the customer to testing, closes out service history, and frees the clerk", async () => {
    const db = mockDb([
      { rows: [{ appointment_id: 501, status: "serving" }] },
      { rowCount: 1 }, // UPDATE queue
      { rows: [{ id: 900 }] }, // INSERT service_history
      { rows: [{ txn_type_ids: [3, 4] }] },
      { rowCount: 2 }, // INSERT service_history_txn_types
      { rowCount: 1 }, // UPDATE clerk_sessions
    ]);

    await sendToWrittenTest(db, TEST_INPUT);

    expect(db.calls).toHaveLength(6);

    const updateQueue = db.calls[1];
    expect(updateQueue.sql).toContain("status = 'testing'");
    expect(updateQueue.sql).toContain("assigned_clerk_id = NULL");
    expect(updateQueue.values).toEqual([QUEUE_ID, 9]);

    expect(db.calls[2].values).toEqual([1, 501, QUEUE_ID, 10]);

    const insertTxns = db.calls[4];
    expect(insertTxns.sql).toContain("VALUES ($1, $2), ($1, $3)");
    expect(insertTxns.values).toEqual([900, 3, 4]);

    const freeClerk = db.calls[5];
    expect(freeClerk.sql).toContain("is_available = TRUE");
    expect(freeClerk.values).toEqual([10, 1]);
  });

  test("skips the transaction-type insert when the appointment has no transactions", async () => {
    const db = mockDb([
      { rows: [{ appointment_id: 501, status: "serving" }] },
      { rowCount: 1 },
      { rows: [{ id: 900 }] },
      { rows: [{ txn_type_ids: [] }] },
      { rowCount: 1 }, // UPDATE clerk_sessions
    ]);

    await sendToWrittenTest(db, TEST_INPUT);

    expect(db.calls).toHaveLength(5);
    expect(db.calls.some((c) => c.sql.includes("service_history_txn_types"))).toBe(false);
  });

  test("throws when the queue entry does not exist", async () => {
    const db = mockDb([{ rows: [] }]);
    await expect(sendToWrittenTest(db, TEST_INPUT)).rejects.toThrow(
      `Queue entry ${QUEUE_ID} not found`,
    );
  });

  test("throws when the queue entry is not being served", async () => {
    const db = mockDb([{ rows: [{ appointment_id: 501, status: "waiting" }] }]);
    await expect(sendToWrittenTest(db, TEST_INPUT)).rejects.toThrow(
      `Queue entry ${QUEUE_ID} not in serving status`,
    );
  });
});

describe("completeWrittenTest", () => {
  test("returns the customer to the waiting queue as a returning visit", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await completeWrittenTest(db, QUEUE_ID);

    expect(db.calls[0].sql).toContain("is_returning = TRUE");
    expect(db.calls[0].sql).toContain("status = 'waiting'");
    expect(db.calls[0].values).toEqual([QUEUE_ID]);
  });

  test("throws when the queue entry is not in testing status", async () => {
    const db = mockDb([{ rowCount: 0 }]);
    await expect(completeWrittenTest(db, QUEUE_ID)).rejects.toThrow(
      `Queue entry ${QUEUE_ID} not found or not in testing status`,
    );
  });
});
