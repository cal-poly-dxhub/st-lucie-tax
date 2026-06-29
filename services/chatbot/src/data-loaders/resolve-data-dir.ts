/**
 * Locate the `data/` directory containing fact-definitions.json,
 * decision-trees/, item-catalog.json, etc.
 *
 * The directory lives in different relative locations depending on how the
 * code is running:
 *   - tsx dev:    chatbot-prototype/services/chatbot/src/data/
 *   - Lambda CJS: /var/task/data/    (commandHooks.afterBundling copies it)
 *
 * This resolver walks a list of candidate paths and returns the first one
 * that exists. Cached after first resolution. Throws if none found so we
 * fail fast at module load rather than later inside the request loop.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

let cached: string | null = null;

const CANDIDATES = [
  // Lambda CJS: bundle is at /var/task/index.js, data copied to /var/task/data/
  () => resolve(process.cwd(), "data"),
  // tsx dev: cwd is chatbot-prototype/, data lives under services/chatbot/src/data
  () => resolve(process.cwd(), "services", "chatbot", "src", "data"),
  // Run from services/chatbot/ subdir
  () => resolve(process.cwd(), "src", "data"),
  // Lambda zip extracted with deeper layout
  () => resolve("/var/task", "data"),
  () => resolve("/var/task", "services", "chatbot", "src", "data"),
];

export function resolveDataDir(): string {
  if (cached) return cached;
  for (const candidate of CANDIDATES) {
    const dir = candidate();
    if (existsSync(resolve(dir, "fact-definitions.json"))) {
      cached = dir;
      return cached;
    }
  }
  const tried = CANDIDATES.map((c) => c()).join("\n  ");
  throw new Error(`Cannot locate data/ directory. Tried:\n  ${tried}`);
}
