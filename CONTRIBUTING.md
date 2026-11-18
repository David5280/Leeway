# Contributing to Leeway

Leeway handles people's money, so the code is held to a high bar. Every
change, however small, meets the standards below before it is merged.

## Code standards

**Organized and modular.** One responsibility per module. Domain logic lives
in `server/src/domain`, actions (the API an app or agent calls) in
`server/src/actions`, screens in `web/src/pages`, shared pieces in
`web/src/components`. Keep files under 300 lines and functions small enough
to read in one sitting; split by responsibility before either grows.

**Readable first.** Name things for what they mean (`safePerDayCents`, not
`spd`). Prefer plain control flow over clever one-liners. No nested ternaries.
Pure logic (budget math, period math, matching) stays free of I/O so it can be
read and tested on its own.

**Comments explain why.** Each module opens with a line saying what it is
for. Exported functions get a short doc comment unless the name and types
already say it all (`listAccounts` needs none). Add short inline comments
where the logic is not obvious: a formula, an edge case, a business rule, a
workaround. Do not narrate obvious code.

**Extremely well tested.** Every feature ships with tests, including its edge
cases and failure paths. Server tests run against a real Postgres database,
because most bugs in an app like this live in queries. Web tests render real
screens against a fake server and check what a person sees and sends.
Coverage thresholds are enforced in `server/vitest.config.ts` and `web/vite.config.ts` and
only ever go up.

**Professional throughout.** Strict TypeScript with no `any`. Errors reach
the person as plain sentences that say what to do next. Money is integer
cents; dates are `YYYY-MM-DD` strings. Nothing ever moves money.

## Before you commit

```sh
npm run check
```

This runs Prettier, ESLint (which enforces the rules above that a tool can
check), the type checker and every test with coverage. It must pass.

## Running the tests

Server tests need Postgres. By default they use
`postgres://postgres@localhost:5432/leeway_test`; set `TEST_DATABASE_URL` to
use another database. The test run drops and recreates that database's
schema, so never point it at real data.

A quick way to get one is Docker:

```sh
docker run -d --name leeway-test-db -p 5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
docker exec leeway-test-db createdb -U postgres leeway_test
```

### Browser tests

`e2e/` holds Playwright tests that drive a real build in a real browser:
first-run setup, signing in and out, the overview, transactions, budgets, the
Plan tab, importing a CSV file, customizing and switching themes, the
dashboard summary switch, the weekly email settings, an assistant connecting
through the consent screen, and a phone-sized screen.
They share one install and run in order; `setup.spec.ts` creates the owner and
saves the signed-in session the others reuse.

They need a database with `e2e` in its name, which every run wipes. The
default is `postgres://postgres@localhost:5432/leeway_e2e`; set
`E2E_DATABASE_URL` to use another. The test server listens on port 3100; set
`E2E_PORT` to use another.

```sh
docker exec leeway-test-db createdb -U postgres leeway_e2e
npx playwright install chromium   # once
npm run build
npm run e2e
```

On a machine where Playwright's browsers will not install, run them in
Playwright's own image instead: `e2e/run-in-docker.sh`. A failed test leaves a
screenshot and a trace in `test-results/`.

CI (`.github/workflows/ci.yml`) runs `npm run check`, a production build, the
browser tests and the Docker image build on every push and pull request.

## Database changes

Add a new numbered file to `server/migrations`, like `004_something.sql`.
Never edit a migration that has shipped: installs that already ran it will
not run it again. Migrations run automatically when the server starts.

## The Railway template

The "Deploy on Railway" button in the README needs a template published from
this repository. The README's "Publishing the Railway template" has the steps
and every variable with its description; keep that table in step with
`.env.example` when adding a setting a new install needs. `railway.json` sets
the build and the health check for every Railway deploy, button or not.
