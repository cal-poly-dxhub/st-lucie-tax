import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./db/tests/globalSetup.ts",
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/cdk.out/**", "**/cdk-lint-out/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
