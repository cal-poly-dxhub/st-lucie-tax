/**
 * Fact-implication loader.
 *
 * Reads fact-implications.json once per Lambda cold start. Each rule declares:
 *   when: Record<factKey, value>   — pattern that triggers the rule
 *   then: Record<factKey, value>   — facts to auto-assert when the pattern holds
 *   note?: string                  — why the implication is valid (author-facing)
 *
 * Rules are applied in `record_facts` AFTER the explicit fact is written, so
 * authoring a dependent fact cascades automatically without the LLM needing to
 * ask the customer a redundant question.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDataDir } from "./resolve-data-dir.js";

export interface FactImplication {
  when: Record<string, string>;
  then: Record<string, string>;
  note?: string;
}

let cache: FactImplication[] | null = null;

export function loadFactImplications(): FactImplication[] {
  if (cache) return cache;
  const jsonPath = resolve(resolveDataDir(), "fact-implications.json");
  const raw = readFileSync(jsonPath, "utf-8");
  cache = JSON.parse(raw) as FactImplication[];
  return cache;
}
