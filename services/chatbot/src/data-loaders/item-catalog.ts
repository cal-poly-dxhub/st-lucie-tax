/**
 * Item-catalog loader.
 * Reads item-catalog.json once per Lambda cold start.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CatalogItem } from "@st-lucie/shared-types";
import { resolveDataDir } from "./resolve-data-dir.js";

let cache: CatalogItem[] | null = null;
let byIdCache: Map<string, CatalogItem> | null = null;

export function loadItemCatalog(): CatalogItem[] {
  if (cache) return cache;
  const jsonPath = resolve(resolveDataDir(), "item-catalog.json");
  const raw = readFileSync(jsonPath, "utf-8");
  cache = JSON.parse(raw) as CatalogItem[];
  byIdCache = new Map(cache.map((i) => [i.itemId, i]));
  return cache;
}

export function getCatalogItem(itemId: string): CatalogItem | undefined {
  if (!byIdCache) loadItemCatalog();
  return byIdCache!.get(itemId);
}
