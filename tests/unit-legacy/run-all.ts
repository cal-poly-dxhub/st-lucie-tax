/**
 * Run every *.test.ts in tests/unit/ sequentially.
 *
 * Usage:
 *   npx tsx tests/unit/run-all.ts
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...findTests(full));
    else if (entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = findTests(__dirname)
  .map(f => f.slice(__dirname.length + 1))
  .sort();

let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const res = spawnSync('npx', ['tsx', resolve(__dirname, f)], {
    stdio: 'inherit',
  });
  if ((res.status ?? 1) !== 0) failed += 1;
}

console.log(`\n${failed === 0 ? 'All unit test files passed.' : `${failed} test file(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
