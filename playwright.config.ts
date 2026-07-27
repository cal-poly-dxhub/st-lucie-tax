import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load local E2E defaults without overriding variables supplied by CI or the shell.
loadEnv({ path: ".env.test", override: false });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 300000, // 5 min per test — Bedrock turns can be slow
  expect: { timeout: 30000 },
  retries: 1, // single retry on flake (Bedrock non-determinism)
  // 4 workers gives ~4x speedup; backend is single-instance but fully async,
  // and Bedrock retry/backoff in bedrock-client.ts absorbs throttling.
  // Override via PW_WORKERS env var (e.g. PW_WORKERS=1 for serial debugging).
  workers: parseInt(process.env.PW_WORKERS ?? "4", 10),
  reporter: [
    ["list"],
    ["json", { outputFile: ".cache/test-pass/2-playwright/playwright-report.json" }],
  ],
  use: {
    baseURL: process.env.FRONTEND || "http://localhost:5180",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 30000,
  },
});
