import type { Queryable } from "../../../../services/office-ops/src/utils.js";

export type Row = Record<string, unknown>;

/**
 * A single scripted response. Queries are consumed in order.
 * - `rows` — rows to return (defaults to []).
 * - `rowCount` — overrides `rows.length` (needed to simulate UPDATE ... rowCount = 0).
 * - `error` — thrown instead of resolving.
 */
export interface MockResponse {
  rows?: Row[];
  rowCount?: number;
  error?: unknown;
}

export interface RecordedCall {
  sql: string;
  values: unknown[] | undefined;
}

export interface MockDb extends Queryable {
  /** Every query issued against this mock, in order. */
  calls: RecordedCall[];
}

/**
 * Builds a `Queryable` that replays `responses` in order and records every call.
 * Throws if the code under test issues more queries than were scripted, so an
 * unexpected extra round-trip fails loudly instead of returning undefined.
 */
export function mockDb(responses: MockResponse[]): MockDb {
  let idx = 0;
  const calls: RecordedCall[] = [];

  return {
    calls,
    query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (idx >= responses.length) {
        throw new Error(`Unexpected query #${idx + 1} (only ${responses.length} mocked): ${sql}`);
      }
      const r = responses[idx++];
      if ("error" in r && r.error !== undefined) return Promise.reject(r.error);
      const rows = r.rows ?? [];
      return Promise.resolve({ rows, rowCount: r.rowCount ?? rows.length });
    },
  } as MockDb;
}

/** A PostgreSQL-shaped error carrying a SQLSTATE code (as node-postgres throws). */
export function pgError(code: string, message = `pg error ${code}`): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
