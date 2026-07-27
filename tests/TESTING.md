# Test Commands

Run these commands from the repository root.

## Unit tests

Run the Office Operations unit tests without requiring PostgreSQL:

```bash
npx vitest run --config vitest.unit.config.ts
```

Run one unit test file:

```bash
npx vitest run --config vitest.unit.config.ts tests/unit/office-ops/find-appt.test.ts
```

## Integration tests

Start the local PostgreSQL database first. The tests use the database configured in the root `.env` file and reset its schema and seed data before running:

```bash
docker compose up -d db
```

Run Office Operations integration tests:

```bash
npx vitest run --config vitest.config.ts tests/integration/office-ops
```

Run database tests:

```bash
npx vitest run --config vitest.config.ts tests/integration/db
```

Run all Vitest tests, including unit and integration tests:

```bash
npm test
```

Run all Vitest tests with coverage:

```bash
npm run test:coverage
```

## Playwright tests

Install the browser once, then export the variables in `tests/.env.test` before running. Playwright does not start the frontend or backend automatically.

```bash
npx playwright install chromium
set -a
source tests/.env.test
set +a
```

Run all Playwright end-to-end tests:

```bash
npx playwright test
```

Run one Playwright spec:

```bash
npx playwright test tests/e2e/trailer-registration.spec.ts
```

Run tests matching a name:

```bash
npx playwright test --grep "vehicle registration"
```

Run Playwright with one worker for serial debugging:

```bash
PW_WORKERS=1 npx playwright test
```
