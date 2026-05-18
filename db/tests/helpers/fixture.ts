import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { connect } from './client.ts';

const TENANT = 'stlucie';

export interface DbContext {
  /** Transactional client for the current test. Rolled back in afterEach. */
  client: Client;
}

/**
 * Wires up a per-test transaction-rollback fixture. Each test gets a fresh
 * BEGIN; the tenant GUC is set inside the transaction so RLS works; the
 * transaction is ROLLBACK'd in afterEach so seed data is never mutated.
 *
 * Usage:
 *   const db = useDb();
 *   test('...', async () => { await db.client.query('SELECT 1'); });
 */
export function useDb(): DbContext {
  const ctx = {} as DbContext;
  let connection: Client | undefined;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(async () => {
    await connection?.end();
  });

  beforeEach(async () => {
    if (!connection) throw new Error('connection not initialised');
    await connection.query('BEGIN');
    await connection.query(`SET LOCAL app.current_tenant = '${TENANT}'`);
    ctx.client = connection;
  });

  afterEach(async () => {
    await connection?.query('ROLLBACK');
  });

  return ctx;
}
