import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/cdk.out/",
      ".claude/",
      ".cache/",
      "test-results/",
      "playwright-report/",
      "**/*.js",
      // Archived KB scraper suite (lifted verbatim from the prototype; kept as
      // reference tooling, not maintained to this repo's lint bar). See
      // scripts/kb/README.md.
      "scripts/kb/",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // Node scripts (seed generators, dev/livetest harnesses) run under Node, not
  // the browser or a bundler — declare Node globals so `console`/`process`/etc.
  // don't trip `no-undef`. These are utility scripts, not shipped app code, so
  // the empty-catch pattern used for best-effort probes is allowed.
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Test fixtures frequently cast tool/DB responses to `any` to poke at shapes;
  // that's acceptable in tests but not in app code.
  {
    files: ["tests/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
