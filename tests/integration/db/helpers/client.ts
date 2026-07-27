import { resolve } from "node:path";
import { Client, type ClientConfig } from "pg";

process.loadEnvFile(resolve(import.meta.dirname, "../../../../.env"));

export const dbConfig: ClientConfig = {
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
};

export async function connect(): Promise<Client> {
  const client = new Client(dbConfig);
  await client.connect();
  return client;
}
