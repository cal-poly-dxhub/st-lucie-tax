/**
 * PostgreSQL connection pool singleton.
 *
 * Replaces the previous DynamoDB Document Client. Uses the same env-var
 * pattern as server/db.ts (PGHOST, PGPORT, PGUSER, PGDATABASE,
 * PGPASSWORD / PGPASSWORD_SECRET_ARN, PGSSL).
 */

import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const { Pool } = pg;

function sslConfig(): pg.PoolConfig["ssl"] {
  if (process.env.PGSSL !== "true") return false;
  if (process.env.PGSSL_REJECT_UNAUTHORIZED === "false" && process.env.NODE_ENV !== "production") {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

let cachedPassword: string | undefined;
async function resolvePassword(): Promise<string> {
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD;
  const arn = process.env.PGPASSWORD_SECRET_ARN;
  if (!arn) return "localdev";
  if (cachedPassword) return cachedPassword;
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(out.SecretString ?? "{}");
  cachedPassword = parsed.password as string;
  return cachedPassword;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST ?? "127.0.0.1",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "stlucie",
      password: resolvePassword,
      database: process.env.PGDATABASE ?? "stlucie",
      ssl: sslConfig(),
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
    });
  }
  return pool;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
