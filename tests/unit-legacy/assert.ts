/**
 * Tiny zero-dependency test harness for Lambda-style unit tests.
 *
 * Why not vitest/jest: the chatbot service ships as plain tsx-runnable
 * TypeScript with no test runner configured. Adding one is a future decision;
 * for now, `test()` registers a named block and `run()` executes them in order,
 * printing pass/fail and exiting non-zero on any failure.
 */

type TestFn = () => Promise<void> | void;

const tests: Array<{ name: string; fn: TestFn }> = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `assertEqual failed${msg ? ` (${msg})` : ''}:\n  expected: ${e}\n  actual:   ${a}`,
    );
  }
}

export async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const failures: Array<{ name: string; err: Error }> = [];

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  FAIL ${name}`);
      failures.push({ name, err: err as Error });
      failed += 1;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  for (const f of failures) {
    console.log(`\n--- ${f.name} ---`);
    console.log(f.err.stack ?? f.err.message);
  }
  if (failed > 0) process.exit(1);
}
