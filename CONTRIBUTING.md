# Contributing to Leeway

Leeway handles people's money, so the code is held to a high bar. Every
change, however small, meets the standards below before it is merged.

## Code standards

**Organized and modular.** One responsibility per module, in the layer it
belongs to (see How the code is organized below). Keep files under 300 lines
and functions small enough to read in one sitting; split by responsibility
before either grows.

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

## How the code is organized

Leeway is two npm workspaces, `server` and `web`, plus browser tests in
`e2e/` and the Scriptable home-screen widget in `widget/`. The web app
imports the server's action definitions for its types, and a few pure server
modules (dates, period words, the import's duplicate check) for their code,
so both sides always agree.

### How a request flows

Everything a person or an assistant can do is an **action**, defined once
with `defineAction` in `server/src/actions/`. Each action has a name, a zod
input schema, a scope (`read` or `write`), a surface (`all`, or `app` for
the owner's eyes only) and a `run` function. The list in
`actions/index.ts` is the whole API.

```
web app:   POST /api/actions/:name   http/actions.ts, signed-in session
assistant: POST /mcp                 http/mcp.ts, OAuth token or agent key
  -> runAction                       actions/action.ts, checks the input schema
  -> action.run                      actions/*.ts
  -> domain functions                domain/*.ts
  -> Postgres                        db/pool.ts
```

- **HTTP** (`server/src/http/`) only checks who is asking and turns errors
  into JSON: sign-in (`auth.ts`), the action API (`actions.ts`), MCP
  (`mcp.ts`), OAuth (`oauth.ts`), bank webhooks (`webhooks.ts`), security
  headers, rate limits and cross-site checks. `app.ts` puts them in order.
- **Actions** (`server/src/actions/`) are thin: pick the inputs, call the
  domain, shape the answer. Actions that need today's date use
  `actions/today.ts`.
- **Domain** (`server/src/domain/`) holds the business rules. Pure logic
  (budget math, duplicate checks, the email's wording) sits in its own files,
  free of I/O, next to the files that query Postgres with `pg`. The weekly
  email has its own folder: what it says, how it looks, when it is due and
  what is stored.
- **Lib** (`server/src/lib/`) is small, pure helpers with no knowledge of
  budgets: dates, time zones, money, periods, durations, schemas, crypto.
- **Outside services** each sit behind an interface so tests use a fake:
  banks in `bank/` (Plaid), the summary writer and the paystub reader in
  `ai/` (Anthropic, behind `writer.ts` and `documents.ts`), email
  in `mail/` (Resend). `context.ts` hands them to every action, as `null`
  when not configured.
- **Errors** meant for the caller are `AppError`s (`errors.ts`) with a code
  and a plain sentence that says what to do next. Anything else is a bug: it
  is logged and the caller gets a generic message.

### The web app

- `web/src/api/`: the only way to the server. `client.ts` calls actions by
  name, typed from the server's own definitions; `hooks.ts` wraps them in
  React Query (`useAction` to read, `useActionMutation` to change, which
  refreshes every read); `settings.ts` saves settings with a live preview.
- `web/src/pages/`: one file per screen (`Overview.tsx`, `Budgets.tsx`, ...),
  with the screen's own parts in a folder of the same name (`pages/plan/`,
  `pages/import/`, ...).
- `web/src/widgets/`: the dashboard's widgets; `library.ts` lists them.
- `web/src/components/`: pieces shared by several screens. `ui.tsx` has the
  small ones (`Card`, `Switch`, `ErrorNote`, `LoadingOrError`); `charts/`
  draws every chart as plain SVG; `rules/` is the rule builder.
- `web/src/lib/`: logic without React where it can be: formatting, dates,
  themes, chart scales, and `csv/` for reading an import file.
  `lib/app.tsx` provides the settings and money formatters to every screen
  through `useApp()`, so screens never pass them down as props.

### Adding things

- **An action:** write it with `defineAction` in the matching file in
  `server/src/actions/`, put its logic in `server/src/domain/`, and add it to
  `actionList`. It is then in the web API and, with surface `all`, an MCP
  tool. Keep an action's name and input and output shapes stable once
  shipped (assistants rely on them); only add to them. Use surface `app` for
  anything that sends the owner's data somewhere or decides where it goes,
  like the AI summary switch and the weekly email.
- **A setting:** add the field with a default to `settingsSchema` in
  `domain/settings.ts` and to `settingsPatchSchema` so `update_settings`
  takes it. A setting only the owner may change stays out of the patch
  schema and gets its own app-only action, as `aiSummary` does. Its control
  goes in a section in `web/src/pages/settings/`, inside one of the groups
  listed in `settings/groups.tsx`.
- **A Settings group:** add one entry to `SETTINGS_GROUPS` in
  `web/src/pages/settings/groups.tsx` (an id, a title, a one-line description
  and its sections). The menu, the address `/settings/<id>` and the tests that
  check every group come from that list. Link to it with `settingsPath`, and
  never rename an id once shipped, since links and bookmarks use it.
- **A dashboard widget:** add its type to `WIDGETS` in `domain/settings.ts`,
  draw it in `web/src/widgets/`, and list it in `widgets/library.ts`.
- **A screen:** add its address to `web/src/routes.ts` and its route in
  `App.tsx` from there, then give it a screen in `e2e/guarded-screens.ts`
  (with long names seeded, and any form people open on it as a `then`
  step), so the phone layout guard checks it. The guard fails, naming the
  route, until every route has one, and lint refuses a `<Route>` path
  written straight into the app (only the catch-all `"*"` may be).
- **A database change:** add a new file to `server/migrations` numbered after
  the highest one, like `011_something.sql`. Migrations run in filename
  order when the server starts, each once, and installs record them by file
  name, so never rename or edit one that has shipped (that is also why two
  share the number 006 and there is no 008).

### Tests

- `server/test/`: one file per area (`budget.test.ts`, `imports.test.ts`,
  ...), against a real Postgres database. `helpers.ts` makes a test context
  and inserts bank data, `actionCaller.ts` calls actions the way the app and
  MCP do, `fakeBank.ts` stands in for Plaid, and `fixtures/` holds shared
  data. HTTP tests build the app with `buildApp` and send it requests.
  Nothing calls a live model: the Anthropic classes take a fake client, and
  `fixtures/paystub.ts` has a fake document reader that records each file
  it is given, so tests check exactly what would leave the server.
- `web/src/`: tests sit next to what they test. `test/fake.tsx` answers
  actions from a fake server and renders a screen signed in; tests find
  things by role and label, as a person would.
- `e2e/`: Playwright, against a real build and database (see below).
- `widget/leeway-widget.js`: the Scriptable script is one plain JavaScript
  file, since Scriptable runs a single file, type-checked with JSDoc by
  `tsc -p widget` against `widget/scriptable.d.ts` and the server's
  `WidgetSummary` type. Everything above its "Scriptable" section is pure
  (connecting, formatting, and layouts as plain data) and is tested as it is
  in `web/src/widget/leeway-widget.test.ts`, including a check that its
  colors match `web/src/lib/theme.ts`. The thin Scriptable part takes
  Scriptable's globals as an argument, so `scriptable.test.ts` runs it
  against stand-ins that record what it draws, sends and saves, and
  `autorun.test.ts` checks the last line starts it when those globals exist.
  The web coverage floors include the script.
- Name tests as sentences about behavior ("refuses a rule whose minimum is
  above its maximum"), and control time through the context's clock
  (`ctx.setNow`) rather than waiting on real timers.

## Before you commit

```sh
npm run check
```

This runs Prettier, ESLint (which enforces the rules above that a tool can
check), the type checker and every test with coverage. It must pass.

One of Leeway's own lint rules, `leeway/money-text` (`eslint/moneyText.js`),
keeps every amount on screen drawn by `<Money cents={...} />`. It catches a
money formatter's result reaching the page directly, through a variable, or
through another name for the formatter (`const fmt = money`). It reads code
without type information, so it cannot follow an amount returned from a
function, kept in an object or array, passed through another function, or
assigned to a variable after it was declared. Don't build amounts those ways
for the page; pass cents to `<Money>` instead.

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
first-run setup, signing in and out, the overview, the accounts dashboard and
account alerts, transactions, budgets, the Plan tab, importing a CSV file,
the Settings groups and their addresses, switching themes, the dashboard
summary switch, the weekly email settings, an assistant connecting through
the consent screen, the home-screen widget's token and script, and
phone-sized screens.
`widget-preview.spec.ts` draws the widget's three sizes from the script's own
layouts as HTML previews and checks nothing spills out; with
`WIDGET_SCREENSHOTS` set to a folder, the widget specs also save pictures of
Settings > Widget and the previews there.
They share one install and run in order; `setup.spec.ts` creates the owner and
saves the signed-in session the others reuse.
The test server runs with no Anthropic key, so no browser test can reach a
model. The paystub specs stand in for the reader at the network
(`e2e/paystub.ts` answers the upload and tells `get_paystub` the server can
read); saving and everything after it runs for real.

The **phone layout guard** (`layout-guard.phone.spec.ts`) opens every screen,
and the forms people open on them (`guarded-screens.ts`), on each phone in
`GUARDED_PHONES` (`phone.ts`): a 390pt iPhone, a 375pt iPhone SE and the
320pt first SE upright, and the first two turned sideways, each with its
status bar, notch and home indicator simulated as an app installed to the
home screen. `seed.ts` fills the install with the longest names Leeway takes
first, and removes them afterwards. Each screen fails if text overlaps text
or a control, is cut off without an ellipsis (or squeezed to a sliver with
one), breaks a word across lines, scrolls the page sideways, comes to rest
under a fixed bar, or shows under the status bar, notch or home indicator
with nothing opaque over it. It also fails on any control a finger's 44px tap
can miss: drawn smaller with no label or invisible hit area to make up the
size, covered by a neighbour or by another control's hit area, or placed
where no scrolling reaches it. Links that share their line with a sentence's
other words are the one exception. Every screen runs again in Neon's wider
font at compact density. A failure names each element and what is
wrong with it.

The checks live in `e2e/layout/`, one file per check, and run inside the
page: `e2e/layout.ts` bundles them with esbuild into one script for
Playwright to run there. `layout-checks.spec.ts` (with
`layout-clipped.spec.ts` for the clipped check and `taps.phone.spec.ts` for
taps) proves each one on small pages broken on purpose, and on the same pages
fixed; when a check changes, add a fixture that fails without the change.

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

## The Railway template

The "Deploy on Railway" button in the README needs a template published from
this repository. The README's "Publishing the Railway template" has the steps
and every variable with its description; keep that table in step with
`.env.example` when adding a setting a new install needs. `railway.json` sets
the build and the health check for every Railway deploy, button or not.
