import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./tests/integration/db/globalSetup.ts",
    fileParallelism: false,
    exclude: [
      "**/node_modules/**",
      "**/cdk.out/**",
      "**/cdk-lint-out/**",
      "**/dist/**",
      "tests/e2e/**",
    ],
    coverage: {
      provider: "v8",
      include: ["services/office-ops/src/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
