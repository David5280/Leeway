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
