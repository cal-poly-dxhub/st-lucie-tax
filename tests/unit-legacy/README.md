# tests/unit-legacy

**These tests are live and expected to pass — "legacy" refers to the runner, not
their status.** They are decision-tree resolution tests that run directly under
`tsx` (not Vitest), which is why `vitest.config.ts` excludes `tests/unit-legacy/**`.

Run one:

```bash
npx tsx tests/unit-legacy/trees/new-vehicle-title.test.ts
```

Each tree has a matching test here. When you change a decision tree, fact, or
item, run the relevant tree's test (see the repo `CLAUDE.md` → "When you change a
tree, fact, or item"). Do not delete these on the assumption that "legacy" means
deprecated.
