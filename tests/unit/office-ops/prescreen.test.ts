import { describe, expect, test } from "vitest";
import {
  createPrescreenQuestion,
  createPrescreenQuestions,
  getPrescreenQuestions,
  savePrescreenResponses,
} from "../../../services/office-ops/src/prescreen.js";
import type { Queryable } from "../../../services/office-ops/src/utils.js";
import { mockDb } from "./helpers/mock-db.js";

function makeDb(insertedRows: object[]): Queryable {
  let insertIdx = 0;
  return {
    query(sql: string) {
      if (/DELETE/.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
      const row = insertedRows[insertIdx++];
      return Promise.resolve({ rows: [row], rowCount: 1 });
    },
  } as unknown as Queryable;
}

describe("createPrescreenQuestions", () => {
  test("returns created questions in order", async () => {
    const db = makeDb([
      { id: 1, txn_type_id: 5, sort_order: 1, question_text: "First?" },
      { id: 2, txn_type_id: 5, sort_order: 2, question_text: "Second?" },
    ]);

    const result = await createPrescreenQuestions(db, 5, [
      { sortOrder: 1, questionText: "First?" },
      { sortOrder: 2, questionText: "Second?" },
    ]);

    expect(result).toEqual([
      { id: 1, txnTypeId: 5, sortOrder: 1, questionText: "First?" },
      { id: 2, txnTypeId: 5, sortOrder: 2, questionText: "Second?" },
    ]);
  });

  test("returns empty array when given no questions", async () => {
    const db = makeDb([]);
    const result = await createPrescreenQuestions(db, 5, []);
    expect(result).toEqual([]);
  });
});

describe("getPrescreenQuestions", () => {
  test("returns camelCased questions for the requested transaction types", async () => {
    const db = mockDb([
      {
        rows: [
          { id: 1, txn_type_id: 5, sort_order: 1, question_text: "First?" },
          { id: 2, txn_type_id: 5, sort_order: 2, question_text: "Second?" },
        ],
      },
    ]);

    await expect(getPrescreenQuestions(db, [5])).resolves.toEqual([
      { id: 1, txnTypeId: 5, sortOrder: 1, questionText: "First?" },
      { id: 2, txnTypeId: 5, sortOrder: 2, questionText: "Second?" },
    ]);
    expect(db.calls[0].values).toEqual([[5]]);
  });

  test("returns an empty list when the transaction types have no questions", async () => {
    const db = mockDb([{ rows: [] }]);
    await expect(getPrescreenQuestions(db, [5, 6])).resolves.toEqual([]);
  });
});

describe("createPrescreenQuestion", () => {
  test("inserts one question and returns it", async () => {
    const db = mockDb([
      { rows: [{ id: 9, txn_type_id: 5, sort_order: 3, question_text: "Third?" }] },
    ]);

    await expect(createPrescreenQuestion(db, 5, 3, "Third?")).resolves.toEqual({
      id: 9,
      txnTypeId: 5,
      sortOrder: 3,
      questionText: "Third?",
    });
    expect(db.calls[0].values).toEqual([5, 3, "Third?"]);
  });
});

describe("createPrescreenQuestions", () => {
  test("replaces the existing question set for the transaction type", async () => {
    const db = mockDb([
      { rowCount: 2 }, // DELETE existing
      { rows: [{ id: 1, txn_type_id: 5, sort_order: 1, question_text: "First?" }] },
    ]);

    await createPrescreenQuestions(db, 5, [{ sortOrder: 1, questionText: "First?" }]);

    expect(db.calls[0].sql).toContain("DELETE FROM prescreen_questions");
    expect(db.calls[0].values).toEqual([5]);
  });
});

describe("savePrescreenResponses", () => {
  test("marks prescreen complete and stores responses as JSON", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await savePrescreenResponses(db, 501, { "1": true, "2": false });

    expect(db.calls[0].sql).toContain("prescreen_completed = TRUE");
    expect(db.calls[0].values).toEqual([501, JSON.stringify({ "1": true, "2": false })]);
  });

  test("throws when the appointment does not exist", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(savePrescreenResponses(db, 501, {})).rejects.toThrow("Appointment 501 not found");
  });
});
