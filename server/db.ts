import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const { Pool } = pg;

// SSL is required when talking to RDS / RDS Proxy. Enabled via PGSSL=true.
// In production the Lambda runs in-VPC and connects to RDS Proxy over TLS;
// locally (docker-compose) PGSSL is unset and we connect without TLS.
function sslConfig(): pg.PoolConfig["ssl"] {
  if (process.env.PGSSL !== "true") return false;
  // RDS/RDS Proxy present Amazon CA certs that are in the Node trust store.
  // Allow opting out of verification only via explicit env for debugging.
  return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" };
}

// Resolve the DB password. In production PGPASSWORD_SECRET_ARN points at the
// RDS-managed secret and we fetch it once (cached) — no plaintext password in
// the Lambda env. Locally PGPASSWORD is used directly. pg accepts an async
// password function, so the first connection awaits the fetch.
let cachedPassword: string | undefined;
async function resolvePassword(): Promise<string> {
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD;
  const arn = process.env.PGPASSWORD_SECRET_ARN;
  if (!arn) return "localdev";
  if (cachedPassword) return cachedPassword;
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-west-2" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(out.SecretString ?? "{}");
  cachedPassword = parsed.password as string;
  return cachedPassword;
}

export const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "stlucie",
  password: resolvePassword,
  database: process.env.PGDATABASE ?? "stlucie",
  ssl: sslConfig(),
  // Keep the per-Lambda pool small; RDS Proxy multiplexes across invocations.
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
