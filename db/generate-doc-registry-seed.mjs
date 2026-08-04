#!/usr/bin/env node
/**
 * Generates db/seed-docs.sql from the chatbot item-catalog.json.
 * Usage: node db/generate-doc-registry-seed.mjs > db/seed-docs.sql
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(__dirname, "../services/chatbot/src/data/item-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const lines = [
  "-- Auto-generated from services/chatbot/src/data/item-catalog.json",
  "-- Run: node db/generate-doc-registry-seed.mjs > db/seed-docs.sql",
  "--",
  `-- Populates document_registry with the full item catalog (${catalog.length} items).`,
  "-- Uses ON CONFLICT to upsert so existing FK references are preserved.",
  "-- Old entries not in the catalog are left in place (orphan-safe).",
  "",
  "INSERT INTO document_registry (doc_id, name, description, alternatives) VALUES",
];

const values = catalog.map((item, i) => {
  const docId = item.itemId.replace(/'/g, "''");
  const label = item.label.replace(/'/g, "''");
  const notes = (item.notes || "").replace(/'/g, "''");
  const comma = i < catalog.length - 1 ? "," : "";
  return `  ('${docId}', '${label}', '${notes}', '{}')${comma}`;
});
lines.push(...values);
lines.push("ON CONFLICT (doc_id) DO UPDATE SET");
lines.push("  name = EXCLUDED.name,");
lines.push("  description = EXCLUDED.description;");

console.log(lines.join("\n"));
