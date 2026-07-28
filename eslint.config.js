import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Build output and test artifacts. Playwright's test-results/ and the
    // .cache/ run markers can hold tens of MB of generated files; linting them
    // produces a report large enough to crash ESLint's formatter.
    ignores: [
      "dist/",
      "node_modules/",
      ".claude/",
      ".cache/",
      "test-results/",
      "playwright-report/",
      "*.js",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
