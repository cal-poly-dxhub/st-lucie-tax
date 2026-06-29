/**
 * Generates seed-flows.sql from the chatbot's decision tree JSON files.
 * Run: node db/generate-flow-seed.mjs > db/seed-flows.sql
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const treesDir = resolve(__dirname, "../services/chatbot/src/data/decision-trees");

const files = readdirSync(treesDir).filter((f) => f.endsWith(".json")).sort();

const lines = [
  "-- Auto-generated from services/chatbot/src/data/decision-trees/*.json",
  "-- Run: node db/generate-flow-seed.mjs > db/seed-flows.sql",
  "--",
  "-- Inserts decision trees into transaction_flows.steps JSONB.",
  "-- Requires transaction_types to be seeded first (for FK resolution).",
  "",
  "INSERT INTO transaction_flows (txn_type_id, steps)",
  "SELECT tt.id, tree.steps",
  "FROM (VALUES",
];

const valueLines = [];
for (const file of files) {
  const raw = readFileSync(resolve(treesDir, file), "utf-8");
  const tree = JSON.parse(raw);
  const escaped = raw.replace(/'/g, "''");
  valueLines.push(`  ('${tree.txnTypeId}', '${escaped}'::jsonb)`);
}

lines.push(valueLines.join(",\n"));
lines.push(") AS tree(txn_type_id_text, steps)");
lines.push("JOIN transaction_types tt ON tt.txn_type_id = tree.txn_type_id_text AND tt.office_id IS NULL");
lines.push("ON CONFLICT (txn_type_id) DO UPDATE SET steps = EXCLUDED.steps;");
lines.push("");

writeFileSync(resolve(__dirname, "seed-flows.sql"), lines.join("\n"), "utf-8");
console.log(`Generated seed-flows.sql with ${files.length} decision trees.`);
