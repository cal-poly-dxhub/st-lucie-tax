import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../../services/office-ops/server/db.js", () => ({
  pool: { query },
  withTransaction: vi.fn(),
}));

import adminRouter from "../../../services/office-ops/server/routes/admin.js";

const testApp = express();
testApp.use(express.json());
testApp.use(adminRouter);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(testApp);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  query.mockReset();
});

const invalidRequests = [
  { method: "PUT", path: "/offices/4", body: { runRatePct: 0 } },
  { method: "PUT", path: "/offices/4", body: { runRatePct: 800 } },
  {
    method: "POST",
    path: "/offices",
    body: { name: "Test Office", totalDesks: 3, runRatePct: 200 },
  },
  {
    method: "POST",
    path: "/offices",
    body: { name: "Test Office", totalDesks: 3, runRatePct: 110.5 },
  },
];

describe("office run-rate validation", () => {
  it.each(invalidRequests)(
    "returns 400 for an invalid $method run rate",
    async ({ method, path, body }) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "runRatePct must be an integer between 1 and 199",
      });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([1, 110, 199])("preserves valid run rates at %s percent", async (runRatePct) => {
    query.mockResolvedValue({
      rows: [{ id: 4, name: "Test Office", total_desks: 3, run_rate_pct: runRatePct }],
    });

    const response = await fetch(`${baseUrl}/offices/4`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runRatePct }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[1]).toEqual([4, null, undefined, null, runRatePct]);
  });
});
