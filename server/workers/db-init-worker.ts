import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from "aws-lambda";
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

export async function handler(
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> {
  const physicalId = "db-schema-init";

  if (event.RequestType === "Delete") {
    return {
      Status: "SUCCESS",
      PhysicalResourceId: physicalId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }

  const password = await getDbPassword();
  const sql = await getSchemaSql();

  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "stlucie",
    password,
    database: process.env.PGDATABASE ?? "stlucie",
    ssl: { rejectUnauthorized: true },
  });

  try {
    await client.connect();
    // Only apply schema if the database is empty (first deploy).
    const { rows } = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'config') AS has_tables",
    );
    if (rows[0].has_tables) {
      console.log("Schema already applied, skipping.");
    } else {
      console.log("Applying schema...");
      await client.query(sql);
      console.log("Schema applied successfully.");
    }
  } finally {
    await client.end();
  }

  return {
    Status: "SUCCESS",
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  };
}
