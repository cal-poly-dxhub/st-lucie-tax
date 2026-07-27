import { describe, expect, test } from "vitest";
import { createPrescreenQuestions } from "../../../services/office-ops/src/prescreen.js";
import type { Queryable } from "../../../services/office-ops/src/utils.js";

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
