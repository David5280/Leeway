# Leeway

A personal finance manager you host yourself. Leeway syncs your bank accounts,
tracks budgets, bills, goals and debts, and gives your AI assistant a secure
connection so it can check in and coach you with your real numbers.

It is free, it runs on your own server, and your financial data never leaves it
except to talk to your bank.

## What it does

- **Budgets** by month, paycheck or week, with alerts before you go over and a
  safe amount to spend per day.
- **Bank sync** through Plaid, with rules that file transactions into your own
  categories automatically.
- **Planning:** bills and subscriptions with due dates, recurring charges found
  for you, savings goals, debt payoff plans (avalanche and snowball), cash left
  until payday, and net worth over time.
- **A dashboard you arrange yourself**, with themes and colors you choose.
- **An AI coach.** Connect Claude or any assistant that speaks MCP. It can run a
  money check-in, tell you whether a purchase fits, review subscriptions and
  plan debt payoff. Keys can be read-only, and no key can ever move money.
- **Works on laptop and phone.** Install it to your home screen like an app.

## Get started

You need two things: somewhere to run it, and (for bank sync) free Plaid keys.
Leeway runs fine without Plaid; you can add accounts and transactions by hand
and connect banks later.

### Option 1: Railway (easiest)

1. In [Railway](https://railway.com), create a project and choose
   **Deploy from GitHub repo**, picking your copy of this repository.
2. Add a database to the project: **New**, then **Database**, then
   **PostgreSQL**.
3. On the Leeway service, open **Variables** and add:
   - `DATABASE_URL` set to `${{Postgres.DATABASE_URL}}`
   - `ENCRYPTION_KEY` set to 64 random hex characters (`openssl rand -hex 32`
     makes one). Keep a copy somewhere safe.
   - `PLAID_CLIENT_ID`, `PLAID_SECRET` and `PLAID_ENV` if you have Plaid keys.
4. Under **Settings**, then **Networking**, click **Generate Domain**.
5. Open that address and follow the setup screens.

### Option 2: Docker on your own machine

```sh
git clone https://github.com/<you>/leeway.git && cd leeway
cp .env.example .env
# Set ENCRYPTION_KEY in .env (openssl rand -hex 32), and Plaid keys if you have them
docker compose up -d
```

Then open http://localhost:3000. The database lives in a Docker volume, so it
survives restarts and upgrades. To upgrade, pull the latest code and run
`docker compose up -d --build`.

### Option 3: From source

You need Node.js 22.12 or newer and PostgreSQL.

```sh
npm install
cp .env.example .env   # set DATABASE_URL and ENCRYPTION_KEY
npm run build
npm start
```

## Settings

Everything is configured with environment variables. `.env.example` lists them
all with notes.

| Variable                | Needed   | What it does                                             |
| ----------------------- | -------- | -------------------------------------------------------- |
| `DATABASE_URL`          | Yes      | Postgres connection string                               |
| `ENCRYPTION_KEY`        | Yes      | 64 hex characters; encrypts bank access tokens at rest   |
| `PUBLIC_URL`            | No       | Your Leeway address, for bank webhooks and the MCP link  |
| `PLAID_CLIENT_ID`       | For sync | From the Plaid dashboard                                 |
| `PLAID_SECRET`          | For sync | From the Plaid dashboard                                 |
| `PLAID_ENV`             | No       | `sandbox` (test banks, the default) or `production`      |
| `PLAID_COUNTRY_CODES`   | No       | Countries to offer banks from, like `US,CA`              |
| `PLAID_REDIRECT_URI`    | No       | Needed by some banks that sign in through their own site |
| `SYNC_INTERVAL_MINUTES` | No       | Background sync interval, default 360; `0` turns it off  |

On Railway, `PUBLIC_URL` is filled in from the generated domain automatically.

### Plaid keys

Create a free account at [Plaid](https://dashboard.plaid.com), then copy the
client ID and secret from **Developers**, then **Keys**. Start with
`PLAID_ENV=sandbox` to try test banks (user `user_good`, password
`pass_good`). Connecting your real banks needs production access, which you
request from the Plaid dashboard.

## Connect your AI assistant

In Leeway, open **Customize**, then **AI assistant**. Create a key, then add the
address shown there (your Leeway address followed by `/mcp`) as a connector in
your assistant, with the key as the bearer token.

Then ask for a money check-in, or whether you can afford something. Assistants
that show MCP prompts also list Leeway's ready-made ones: a check-in, a
purchase check, debt payoff, a subscription review, a review of last period
and budget setup.

A read-only key lets the assistant look. A read and write key also lets it
change budgets, categories and rules. Neither can move money, pay a bill or
cancel a subscription.

## Keeping your data safe

- Bank access tokens are encrypted with your `ENCRYPTION_KEY`. Lose the key and
  you will need to link your banks again; your other data is unaffected.
- Back up the database. Railway's Postgres has backups in its settings; with
  Docker, `docker compose exec db pg_dump -U leeway leeway > leeway.sql`.
- **Customize**, then **Backup** exports your categories, rules and settings to
  a file you can import into another Leeway.
- Forgot your password? On the server, run `npm run reset-password` (from
  source) or
  `docker compose exec leeway node server/dist/src/cli/reset-password.js`
  (Docker). It prints a temporary password and signs out every device.

## Development

```sh
npm install
npm run dev     # API on :3000, web app with live reload on :5173
npm run check   # formatting, lint, types and every test; must pass before a commit
```

Server tests need a Postgres database; see [CONTRIBUTING.md](CONTRIBUTING.md)
for that and for the code standards every change meets.
