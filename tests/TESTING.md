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

Start the local PostgreSQL database first:

```bash
docker compose up -d db
```

The integration global setup resets the DB by running `db/reset.sh`, which uses
the **`finch`** container runtime (not `docker`) and psql's in as user/db
`stlucie`/`stlucie` (it ignores the `.env` values). If you use Docker rather than
finch, either install finch or change the `finch exec` calls in `db/reset.sh` to
`docker exec`.

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

Install the browser once, then provide the test credentials. `playwright.config.ts`
auto-loads a **`.env.test` at the repo root** (via dotenv). Copy the template and
fill it in; note the chatbot e2e specs require `BETA_EMAIL`, `BETA_PASSWORD`, and
`PLAYWRIGHT_FRONTEND_URL`. Playwright does not start the frontend or backend
automatically.

```bash
npx playwright install chromium
cp tests/.env.test.example .env.test   # repo root — edit in your values
```

(If you keep the file at `tests/.env.test` instead, export it into the shell
before running: `set -a; source tests/.env.test; set +a`.)

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
