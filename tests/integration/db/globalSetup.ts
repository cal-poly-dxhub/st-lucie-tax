import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

export default async function globalSetup() {
  const resetScript = resolve(__dirname, "..", "..", "..", "db", "reset.sh");
  execSync(`bash ${resetScript}`, { stdio: "inherit" });

  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));

  const client = new Client({
    host: process.env.PGHOST,
    port: 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  await client.connect();
  try {
    const fixture = readFileSync(resolve(import.meta.dirname, "test-fixture.sql"), "utf8");
    await client.query(fixture);
  } finally {
    await client.end();
  }
}
