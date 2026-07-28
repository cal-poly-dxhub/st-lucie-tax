import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Build output and test artifacts. Note the `**/` prefixes: a flat-config
    // ignore pattern containing a slash is anchored to the repo root, so a bare
    // `dist/` would miss the per-workspace dist directories and ESLint would
    // lint thousands of generated files.
    ignores: [
      "**/dist/",
      "**/node_modules/",
      ".claude/",
      ".cache/",
      "test-results/",
      "playwright-report/",
      "**/*.js",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
