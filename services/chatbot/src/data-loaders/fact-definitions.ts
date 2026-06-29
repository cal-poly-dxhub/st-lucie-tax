/**
 * Fact-definition loader.
 * Reads fact-definitions.json from the data/ dir once per Lambda cold start.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FactDefinition } from "@st-lucie/shared-types";
import { resolveDataDir } from "./resolve-data-dir.js";

let cache: FactDefinition[] | null = null;
let byKeyCache: Map<string, FactDefinition> | null = null;

function resolveDataFile(name: string): string {
  const dir = resolveDataDir();
  return resolve(dir, name);
}
// Verify the resolved file exists at module load (fail fast if not)
if (!existsSync(resolveDataFile("fact-definitions.json"))) {
  throw new Error(`fact-definitions.json not found at ${resolveDataFile("fact-definitions.json")}`);
}

export function loadFactDefinitions(): FactDefinition[] {
  if (cache) return cache;
  const jsonPath = resolveDataFile("fact-definitions.json");
  const raw = readFileSync(jsonPath, "utf-8");
  cache = JSON.parse(raw) as FactDefinition[];
  byKeyCache = new Map(cache.map((f) => [f.factKey, f]));
  return cache;
}

export function getFactDefinition(factKey: string): FactDefinition | undefined {
  if (!byKeyCache) loadFactDefinitions();
  return byKeyCache!.get(factKey);
}

export function getFactsForTransactions(txnTypeIds: string[]): FactDefinition[] {
  const defs = loadFactDefinitions();
  const txnSet = new Set(txnTypeIds);
  return defs.filter(
    (f) => f.scope === "global" || f.relevantTransactions.some((t) => txnSet.has(t)),
  );
}
