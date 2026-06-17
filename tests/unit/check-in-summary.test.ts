import { describe, expect, test } from "vitest";
import { getCheckInSummary } from "../../src/check-in.js";
import type { Queryable } from "../../src/utils.js";

type Row = Record<string, unknown>;

function makeDb(responses: Array<{ rows: Row[] }>): Queryable {
  let idx = 0;
  return {
    query() {
      if (idx >= responses.length) {
        throw new Error(`Unexpected query #${idx + 1} (only ${responses.length} mocked)`);
      }
      const r = responses[idx++];
      return Promise.resolve({ rows: r.rows, rowCount: r.rows.length });
    },
  } as Queryable;
}

function apptRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 1,
    first_name: "Jane",
    last_name: "Doe",
    identity_verified: true,
    prescreen_completed: true,
    required_doc_ids: ["drivers_license", "tax_bill"],
    ...overrides,
  };
}

describe("getCheckInSummary", () => {
  test("throws when appointment not found", async () => {
    const db = makeDb([{ rows: [] }]);
    await expect(getCheckInSummary(db, 999)).rejects.toThrow("Appointment 999 not found");
  });

  test("empty required_doc_ids: skips doc query, docsReady=true", async () => {
    const db = makeDb([{ rows: [apptRow({ required_doc_ids: [] })] }]);

    const result = await getCheckInSummary(db, 1);
    expect(result.docsReady).toBe(true);
    expect(result.missingDocs).toEqual([]);
    expect(result.pendingDocs).toEqual([]);
  });

  test("doc with no uploads is missing (clerk_validated=null)", async () => {
    const db = makeDb([
      { rows: [apptRow()] },
      {
        rows: [
          { doc_id: "drivers_license", clerk_validated: true },
          { doc_id: "tax_bill", clerk_validated: null },
        ],
      },
    ]);

    const result = await getCheckInSummary(db, 1);
    expect(result.missingDocs).toEqual(["tax_bill"]);
    expect(result.docsReady).toBe(false);
  });

  test("doc uploaded but not validated is pending", async () => {
    const db = makeDb([
      { rows: [apptRow()] },
      {
        rows: [
          { doc_id: "drivers_license", clerk_validated: true },
          { doc_id: "tax_bill", clerk_validated: false },
        ],
      },
    ]);

    const result = await getCheckInSummary(db, 1);
    expect(result.pendingDocs).toEqual(["tax_bill"]);
    expect(result.docsReady).toBe(false);
  });

  test("docsReady=true when all required docs have clerk_validated=true", async () => {
    const db = makeDb([
      { rows: [apptRow()] },
      {
        rows: [
          { doc_id: "drivers_license", clerk_validated: true },
          { doc_id: "tax_bill", clerk_validated: true },
        ],
      },
    ]);

    const result = await getCheckInSummary(db, 1);
    expect(result.docsReady).toBe(true);
    expect(result.missingDocs).toEqual([]);
    expect(result.pendingDocs).toEqual([]);
  });
});
