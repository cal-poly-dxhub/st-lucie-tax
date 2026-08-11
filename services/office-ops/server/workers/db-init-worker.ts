import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";

const { Client } = pg;

async function getDbPassword(): Promise<string> {
  const arn = process.env.PGPASSWORD_SECRET_ARN;
  if (!arn) throw new Error("PGPASSWORD_SECRET_ARN not set");
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-west-2" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(out.SecretString ?? "{}");
  return parsed.password as string;
}

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-2" });

async function getSqlObject(bucket: string, key: string): Promise<string> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!resp.Body) throw new Error(`S3 object s3://${bucket}/${key} returned empty Body`);
  return await resp.Body.transformToString("utf-8");
}

async function getSchemaSql(): Promise<string> {
  const bucket = process.env.SCHEMA_BUCKET;
  const key = process.env.SCHEMA_KEY;
  if (!bucket || !key) throw new Error("SCHEMA_BUCKET/SCHEMA_KEY not set");
  return getSqlObject(bucket, key);
}

/**
 * Operational seed SQL, applied ONLY on a fresh (empty) database right after the
 * schema. SEED_BUCKET + SEED_KEYS (comma-separated, ordered) are wired by CDK to
 * the seed assets (seed.sql, seed-docs.sql, seed-flows.sql). Order matters —
 * flows/docs reference rows created by seed.sql. Returns [] when unconfigured
 * (backward-compatible: schema-only apply).
 */
async function getSeedSqls(): Promise<{ key: string; sql: string }[]> {
  const bucket = process.env.SEED_BUCKET;
  const keys = (process.env.SEED_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!bucket || keys.length === 0) return [];
  const out: { key: string; sql: string }[] = [];
  for (const key of keys) out.push({ key, sql: await getSqlObject(bucket, key) });
  return out;
}

// Plain invokable handler — NOT a CloudFormation custom resource. Deployed by
// CDK but never run at deploy time. Apply the schema by invoking it manually
// once the DB/proxy are up, e.g.:
//   aws lambda invoke --function-name <DbInitFnName> /dev/stdout
// Idempotent: skips if the schema is already present. Pass { force: true } to
// re-apply the schema regardless. On a FRESH (empty) DB it also loads the
// operational seed data so the app is usable immediately; on an already-seeded
// DB it never re-seeds (avoids duplicate rows).
export async function handler(event?: { force?: boolean }): Promise<{
  status: "applied" | "skipped";
  seeded?: boolean;
}> {
  const password = await getDbPassword();
  const sql = await getSchemaSql();
  const seeds = await getSeedSqls();

  // RDS Proxy reaches CREATE_COMPLETE before its target DB finishes
  // registering, so the first connections after a fresh deploy can be dropped
  // ("Connection terminated unexpectedly"). Retry with backoff until the
  // target is healthy. A pg Client cannot be reused after a failed connect,
  // so build a new one each attempt.
  const makeClient = () =>
    new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "stlucie",
      password,
      database: process.env.PGDATABASE ?? "stlucie",
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 10_000,
    });

  let client!: InstanceType<typeof Client>;
  const maxAttempts = 10;
  for (let attempt = 1; ; attempt++) {
    client = makeClient();
    try {
      await client.connect();
      break;
    } catch (err) {
      await client.end().catch(() => {});
      if (attempt >= maxAttempts) throw err;
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      console.log(
        `DB connect attempt ${attempt}/${maxAttempts} failed (${(err as Error).message}); retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  try {
    // Only apply schema if the database is empty, unless force is requested.
    const { rows } = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'config') AS has_tables",
    );
    if (rows[0].has_tables && !event?.force) {
      console.log("Schema already applied, skipping.");
      return { status: "skipped" };
    }
    console.log("Applying schema...");
    await client.query(sql);
    console.log("Schema applied successfully.");

    // Load operational seed data on a fresh apply so the app is usable
    // immediately (offices, transaction types, clerks, document registry,
    // decision-tree flows). Skipped when nothing is wired (schema-only mode).
    // Order matters: SEED_KEYS lists seed.sql (transaction_types) before
    // seed-flows.sql (which JOINs transaction_types). Each query() runs as its
    // own implicit transaction, which is fine — a later file failing does not
    // roll back an earlier one, and the whole apply only runs on an empty DB.
    let seeded = false;
    if (seeds.length > 0) {
      for (const { key, sql: seedSql } of seeds) {
        console.log(`Applying seed ${key}...`);
        await client.query(seedSql);
      }
      seeded = true;
      console.log(`Seed data applied (${seeds.length} file(s)).`);
    }
    return { status: "applied", seeded };
  } finally {
    await client.end();
  }
}
