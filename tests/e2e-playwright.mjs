import console from "node:console";
import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(
  "npx",
  // The office flow is stateful, so keep this compatibility entry point serial.
  ["playwright", "test", "tests/e2e/office-operations.spec.ts", "--workers=1"],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
