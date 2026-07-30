import { describe, expect, it, vi } from "vitest";

vi.mock("../../../services/office-ops/server/db.js", () => ({
  pool: { query: vi.fn() },
}));

import {
  buildAuditDetails,
  buildAuditLogQueries,
} from "../../../services/office-ops/server/audit.js";

describe("buildAuditDetails", () => {
  it("persists both snapshots for an update", () => {
    const before = { id: 1, name: "Fort Pierce Office", run_rate_pct: 100 };
    const after = { id: 1, name: "Fort Pierce Office", run_rate_pct: 85 };

    expect(
      buildAuditDetails({
        action: "update",
        entityType: "office",
        before,
        after,
      }),
    ).toEqual({ before, after });
  });

  it("keeps create and delete details available as one-sided snapshots", () => {
    expect(
      buildAuditDetails({
        action: "create",
        entityType: "office",
        details: { name: "New office" },
      }),
    ).toEqual({ before: null, after: { name: "New office" } });

    expect(
      buildAuditDetails({
        action: "delete",
        entityType: "office",
        details: { name: "Closed office" },
      }),
    ).toEqual({ before: { name: "Closed office" }, after: null });
  });

  it("retains old unstructured update details", () => {
    expect(
      buildAuditDetails({
        action: "update",
        entityType: "office",
        details: { name: "Historic entry" },
      }),
    ).toEqual({ name: "Historic entry" });
  });
});

describe("buildAuditLogQueries", () => {
  it("parameterizes entity, search, and timestamp filters for results and totals", () => {
    const filters = {
      limit: 50,
      offset: 100,
      entityType: "hotbutton",
      search: "renewal",
      startAt: "2026-07-30T21:00:00.000Z",
      endAt: "2026-07-30T22:00:00.000Z",
    };
    const result = buildAuditLogQueries(filters);

    expect(result.query).toContain("entity_type = $1");
    expect(result.query).toContain("details::text ILIKE $2");
    expect(result.query).toContain("created_at >= $3::timestamptz");
    expect(result.query).toContain("created_at <= $4::timestamptz");
    expect(result.query).toContain("LIMIT $5 OFFSET $6");
    expect(result.countQuery).toContain("entity_type = $1");
    expect(result.params).toEqual([
      "hotbutton",
      "%renewal%",
      "2026-07-30T21:00:00.000Z",
      "2026-07-30T22:00:00.000Z",
      50,
      100,
    ]);
    expect(result.countParams).toEqual(result.params.slice(0, -2));
  });
});
