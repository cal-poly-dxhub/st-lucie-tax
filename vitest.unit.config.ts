import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["services/office-ops/tests/unit/**/*.test.ts"],
  },
});
