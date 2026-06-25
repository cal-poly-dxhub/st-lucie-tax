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

async function getSchemaSql(): Promise<string> {
  const bucket = process.env.SCHEMA_BUCKET;
  const key = process.env.SCHEMA_KEY;
  if (!bucket || !key) throw new Error("SCHEMA_BUCKET/SCHEMA_KEY not set");
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-2" });
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return await resp.Body!.transformToString("utf-8");
}

// Plain invokable handler — NOT a CloudFormation custom resource. Deployed by
// CDK but never run at deploy time. Apply the schema by invoking it manually
// once the DB/proxy are up, e.g.:
//   aws lambda invoke --function-name <DbInitFnName> /dev/stdout
// Idempotent: skips if the schema is already present. Pass { force: true } to
// re-apply regardless.
export async function handler(event?: { force?: boolean }): Promise<{
  status: "applied" | "skipped";
}> {
  const password = await getDbPassword();
  const sql = await getSchemaSql();

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
    return { status: "applied" };
  } finally {
    await client.end();
  }
}
