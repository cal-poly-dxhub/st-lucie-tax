import { resolve } from "node:path";
import { Client, type ClientConfig } from "pg";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));

export const dbConfig: ClientConfig = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "stlucie",
  password: process.env.PGPASSWORD ?? "localdev",
  database: process.env.PGDATABASE ?? "stlucie",
};

export async function connect(): Promise<Client> {
  const client = new Client(dbConfig);
  await client.connect();
  return client;
}
