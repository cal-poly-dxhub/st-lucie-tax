# Contributing

Thanks for your interest! This repository is a proof-of-concept reference
implementation from the Cal Poly DxHub. It is shared primarily as a learning
resource, so contributions are welcome but reviewed on a best-effort basis.

## Getting set up

Prerequisites and the full deploy runbook live in [`README.md`](README.md) and
[`infra/DEPLOY.md`](infra/DEPLOY.md). For local development:

```bash
npm install            # postinstall builds the workspace packages (packages/*/dist)
docker compose up -d db # local Postgres (see compose.yml)
```

This is an npm-workspaces monorepo (`packages/*`, `services/*`, `apps/*`,
`frontend`). The shared packages (`packages/shared-types`, `packages/data-access`)
are consumed via their built `dist/` output, so run `npm run build:packages`
after changing them (it also runs automatically on `npm install`).

## Before you open a PR

Please make sure the following pass locally:

```bash
npm run lint          # eslint
npm run format:check  # prettier
npm test              # vitest (needs the local Postgres container up)
npm run synth         # cdk synth — infra still synthesizes
```

For decision-tree / fact / item changes, also run the relevant tree test and the
tree linter (see [`CLAUDE.md`](CLAUDE.md)):

```bash
npx tsx scripts/lint-decision-trees.ts
npx tsx tests/unit-legacy/trees/<transaction>.test.ts
```

## Guidelines

- **Never commit secrets or real data.** `.env`, `cdk.out/`, and
  `scripts/livetest/` are gitignored — keep credentials, real AWS account IDs,
  real endpoints, and any real constituent data out of the tree and out of
  commit messages. Use `@example.com` emails and placeholder IDs in tests and
  docs.
- Keep changes focused and match the surrounding code style (Prettier +
  ESLint enforce most of it).
- The decision trees and item catalog are the single source of truth for "what
  the customer must bring" — read the per-tree `*.review.md` before changing a
  tree; many findings are intentional.
- Report security issues privately per [`SECURITY.md`](SECURITY.md), not as a
  public issue.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
