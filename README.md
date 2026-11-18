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
- **CSV import** for history from your bank's export or another budgeting app.
  You check a preview first, duplicates are skipped, and an import can be
  undone.
- **Planning:** bills and subscriptions with due dates, recurring charges found
  for you, savings goals, debt payoff plans (avalanche and snowball), cash left
  until payday, and net worth over time.
- **A dashboard you arrange yourself**, with themes and colors you choose, and
  a summary at the top that says in a sentence how the period is going and
  what needs you. Leeway writes it from your numbers, or Claude can write it
  if you add an Anthropic key.
- **A weekly email**, if you want one, with that summary, what's left, bills
  before payday and anything that needs you.
- **An AI coach.** Connect Claude or any assistant that speaks MCP. It can run a
  money check-in, tell you whether a purchase fits, review subscriptions and
  plan debt payoff. You approve what it may do, and nothing can ever move
  money.
- **Works on laptop and phone.** Install it to your home screen like an app.

## Get started

You need two things: somewhere to run it, and (for bank sync) free Plaid keys.
Leeway runs fine without Plaid; you can add accounts and transactions by hand
and connect banks later.

### Option 1: Railway (easiest)

<!--
  PLACEHOLDER: TEMPLATE_CODE in the button link below is not a real template yet.
  Replace it with the published template's code, then delete this comment and
  the placeholder note under the button. See "Publishing the Railway template".
-->

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/TEMPLATE_CODE?utm_medium=integration&utm_source=button&utm_campaign=leeway)

> **Placeholder:** the button goes live once the template is published (see
> [Publishing the Railway template](#publishing-the-railway-template)). Until
> then, use the steps under "Without the button".

The button makes a Railway project with Leeway and its own PostgreSQL
database, generates an encryption key and gives Leeway a public address. The
database is set up automatically, and again on every upgrade. When the deploy
finishes:

1. Open the address shown on the Leeway service. The first visit leads to
   setup, where you create your sign-in. It asks for a setup code, so nobody
   who finds your address first can claim it: copy `SETUP_CODE` from the
   service's **Variables**.
2. Copy `ENCRYPTION_KEY` from the service's **Variables** and keep it somewhere
   safe. Without it, connected banks have to be linked again.
3. For bank sync, fill in `PLAID_CLIENT_ID` and `PLAID_SECRET` there too (see
   [Plaid keys](#plaid-keys)). Until then, add accounts by hand or import your
   bank's CSV export.

If a required variable is missing, the deploy log says which one and how to
set it.

#### Without the button

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
5. Open that address and follow the setup screens. The first one asks for a
   setup code, so nobody who finds your address first can claim it: open the
   service's **Deploy Logs** and copy the code from the line that starts
   `No account yet`.

#### Publishing the Railway template

For the maintainer: the button above works only once this is done. **The
GitHub repository must be public**, because everyone who deploys the template
needs to be able to read it.

1. Make the repository public on GitHub.
2. In Railway, open your workspace's **Settings**, then **Templates**, and
   choose **New Template**.
3. Add **Database**, then **PostgreSQL**; then add **GitHub Repo**, pick this
   repository and name the service `Leeway`.
4. On the Leeway service, set the variables in the table below, and under
   **Settings**, then **Networking**, turn on a public HTTP domain.
5. Choose **Create Template**, then **Publish**, with a name, a short
   description and a category.
6. Copy the template's code (the last part of its
   `railway.com/new/template/...` address) over `TEMPLATE_CODE` in the button
   link above, and delete the placeholder comment and note.

| Variable          | Value                                                | Description to show                                                                         |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`                         | The project's own database. Leave as is.                                                    |
| `ENCRYPTION_KEY`  | `${{secret(64, "abcdef0123456789")}}`                | Encrypts bank access tokens. Made for you; copy it somewhere safe after deploying.          |
| `SETUP_CODE`      | `${{secret(16, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")}}` | Proves you own this install when you create your account. Made for you.                     |
| `PLAID_CLIENT_ID` | empty, optional                                      | For bank sync, from dashboard.plaid.com (Developers, Keys). Empty runs Leeway without sync. |
| `PLAID_SECRET`    | empty, optional                                      | For bank sync, from the same page as the client ID.                                         |
| `PLAID_ENV`       | `sandbox`                                            | `sandbox` for Plaid's test banks, `production` for real ones.                               |

The build (`Dockerfile`) and the health check (`/api/health`) come from
`railway.json` in the repository, so they need no setting in the template.

### Option 2: Docker on your own machine

```sh
git clone https://github.com/<you>/leeway.git && cd leeway
cp .env.example .env
# Set ENCRYPTION_KEY in .env (openssl rand -hex 32), and Plaid keys if you have them
docker compose up -d
```

Then open http://localhost:3000. The setup screen asks for a code that Leeway
prints in its log; `docker compose logs leeway` shows it. The database lives in a Docker volume, so it
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

The setup screen asks for the code Leeway prints when it starts.

## Settings

Everything is configured with environment variables. `.env.example` lists them
all with notes.

| Variable                | Needed   | What it does                                                 |
| ----------------------- | -------- | ------------------------------------------------------------ |
| `DATABASE_URL`          | Yes      | Postgres connection string                                   |
| `ENCRYPTION_KEY`        | Yes      | 64 hex characters; encrypts bank access tokens at rest       |
| `PUBLIC_URL`            | No       | Your Leeway address, for bank webhooks and assistants        |
| `TRUST_PROXY`           | No       | Proxies in front of Leeway (see Security); usually empty     |
| `SETUP_CODE`            | No       | Your own code for creating the account, instead of the log's |
| `PLAID_CLIENT_ID`       | For sync | From the Plaid dashboard                                     |
| `PLAID_SECRET`          | For sync | From the Plaid dashboard                                     |
| `PLAID_ENV`             | No       | `sandbox` (test banks, the default) or `production`          |
| `PLAID_COUNTRY_CODES`   | No       | Countries to offer banks from, like `US,CA`                  |
| `PLAID_REDIRECT_URI`    | No       | Needed by some banks that sign in through their own site     |
| `SYNC_INTERVAL_MINUTES` | No       | Background sync interval, default 360; `0` turns it off      |
| `ANTHROPIC_API_KEY`     | No       | Lets Claude write the dashboard summary (see below)          |
| `SUMMARY_MODEL`         | No       | The Claude model for the summary, default `claude-opus-5-5`  |
| `RESEND_API_KEY`        | No       | Lets Leeway send the weekly email (see below)                |
| `MAIL_FROM`             | No       | The weekly email's sender, like `Leeway <me@example.com>`    |

On Railway, `PUBLIC_URL` is filled in from the generated domain automatically.

### Plaid keys

Create a free account at [Plaid](https://dashboard.plaid.com), then copy the
client ID and secret from **Developers**, then **Keys**. Start with
`PLAID_ENV=sandbox` to try test banks (user `user_good`, password
`pass_good`). Connecting your real banks needs production access, which you
request from the Plaid dashboard.

Leeway dates bank transactions by the day you bought something, not the day it
posted. Transactions synced by an older version still show the posted day;
**Customize**, then **Banks**, then **Use purchase dates for older
transactions** moves them. It changes only dates and is safe to run again.

## Connect your AI assistant

Your connector address is your Leeway address followed by `/mcp`, like
`https://leeway-yourname.up.railway.app/mcp`. **Customize**, then **AI
assistant**, shows it with a Copy button.

**Claude (web, desktop or phone).** In Claude, open **Customize**, then
**Connectors**, and choose **Add custom connector**. Name it Leeway, paste the
address and choose **Connect**. Leeway opens and asks you to approve; you can
let Claude look only, or look and change budgets. Leeway then works in every
chat, on every device. Claude's connectors reach Leeway from the internet, so
this needs Leeway on a public `https` address, which Railway gives you.

**Claude Code.** Run this, then `/mcp` inside Claude Code to sign in:

```sh
claude mcp add --transport http leeway https://your-leeway-address/mcp
```

**Other assistants.** Any assistant that speaks MCP over HTTP can connect. If it
can sign in (MCP's OAuth), give it the address. If it needs a bearer token,
create a key in **Customize**, then **AI assistant**, and use that.

Then ask for a money check-in, or whether you can afford something. Assistants
that show MCP prompts also list Leeway's ready-made ones: a check-in, a
purchase check, debt payoff, a subscription review, a review of last period
and budget setup.

Looking lets the assistant read your accounts, spending, budgets and goals.
Changing also lets it edit budgets, categories, rules and goals. Neither can
move money, pay a bill or cancel a subscription. Connected apps and keys are
listed in **Customize**, then **AI assistant**, where you can disconnect or
revoke any of them at once.

### How signing in works

Leeway is its own OAuth 2.1 authorization server for the MCP endpoint, as the
MCP authorization spec describes. Assistants find it through
`/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`, identify themselves with a client
metadata document or dynamic registration, and sign in with PKCE. Access
tokens last an hour; refresh tokens last 90 days and change on every use. Every
token is stored only as a hash.

## The dashboard summary

The top of the dashboard sums up the period in a sentence and a few points:
whether you're on track, what needs you today, cash until payday, goals and net
worth. Leeway writes it from your numbers on its own.

To have Claude write it instead, add `ANTHROPIC_API_KEY` (from the
[Anthropic Console](https://console.anthropic.com)) to your server's
variables, then turn on **Have Claude write it** in **Customize**, then **AI
assistant**. Nothing is sent until you turn it on. When on, Leeway sends this
period's totals, cash until payday, the Heads up list, and your bill and goal
names; never your accounts or transactions. A summary is saved and reused
while your numbers stay the same, or for up to four hours, and a new day starts
fresh, so it costs a few cents a summary on your own Anthropic account. If
Claude can't be reached, Leeway's own summary shows instead.

## Weekly email

Once a week, Leeway can email you the dashboard summary with what's left this
period and per day, the Heads up list, bills due before payday, and how your
goals are doing, with a button that opens Leeway. It holds totals, bill and
goal names only: never account numbers or transactions.

It sends through [Resend](https://resend.com)'s HTTPS API, since many hosts,
Railway included, block outgoing SMTP. To set it up:

1. Make a free Resend account and add your domain under **Domains**. Resend
   only sends from a verified domain, so add the DNS records it shows you and
   wait for it to say Verified.
2. Make an API key under **API Keys** (sending access is enough).
3. Add two variables to your server: `RESEND_API_KEY` set to that key, and
   `MAIL_FROM` set to an address on the verified domain, like
   `Leeway <leeway@yourdomain.com>`.
4. In **Customize**, then **Email**, turn on the weekly email and choose the
   day, the hour (in your time zone setting) and the address. It goes to your
   sign-in email unless you name another. **Send a test email now** shows you
   one straight away.

Nothing is sent until you turn it on. Only you can, in the app: connected
assistants can neither see nor change the email or its address. If a send
fails, Leeway tries again an hour later, a few times, and Customize shows the
last error. The email's button needs Leeway's address, which Railway fills in;
elsewhere, set `PUBLIC_URL`.

## Keeping your data safe

- Bank access tokens are encrypted with your `ENCRYPTION_KEY`. Lose or change
  the key and each bank shows that it needs linking again: remove it in
  **Customize** and link it once more. Your other data is unaffected.
- Back up the database. Railway's Postgres has backups in its settings; with
  Docker, `docker compose exec db pg_dump -U leeway leeway > leeway.sql`.
- **Customize**, then **Data** exports your categories, rules and settings to
  a file you can import into another Leeway.
- Forgot your password? On the server, run `npm run reset-password` (from
  source) or
  `docker compose exec leeway node server/dist/src/cli/reset-password.js`
  (Docker). It prints a temporary password and signs out every device.

## Security

Leeway is built to sit on the public internet with one owner.

- **Signing in.** Passwords are hashed with scrypt. Sign-in slows down after
  repeated mistakes from one address, and pauses for everyone after 20 wrong
  passwords in 15 minutes. Creating the account takes the setup code from the
  server log, so nobody who finds a new install first can claim it.
- **Sessions** are `HttpOnly`, `SameSite=Strict` cookies, `Secure` over https.
  They end after 30 days, at sign-out, and for every device when the password
  changes. Changes are accepted only from Leeway's own pages.
- **Secrets at rest.** Bank access tokens are encrypted (AES-256-GCM) and never
  returned by any screen or assistant tool. Sessions, assistant keys and
  sign-in tokens are stored only as hashes.
- **The browser** gets a strict Content Security Policy, HSTS and no framing.
  Nothing in Leeway can move money.

What you should do:

- Set `ENCRYPTION_KEY` to 64 random hex characters (`openssl rand -hex 32`) and
  keep a copy apart from your database backups; together they open your bank
  tokens.
- Serve Leeway over https only (Railway does), keep Postgres off the public
  internet, and update Leeway now and then.
- Leave `TRUST_PROXY` empty unless your setup differs: Leeway trusts Railway's
  edge, or one reverse proxy on your own network, to say who is visiting. Set
  `0` if Leeway faces the internet directly, or `2` with a CDN in front too.
- Look over **Customize**, then **AI assistant** now and then, and revoke apps
  and keys you no longer use.
- If you think someone else got in: reset your password (above), revoke every
  app and key, and if the database or `ENCRYPTION_KEY` may have leaked, remove
  and link each bank again (that makes new bank tokens) under a new key.

## Development

```sh
npm install
npm run dev     # API on :3000, web app with live reload on :5173
npm run check   # formatting, lint, types and every test; must pass before a commit
```

Server tests need a Postgres database; see [CONTRIBUTING.md](CONTRIBUTING.md)
for that and for the code standards every change meets.

## License

Copyright (C) 2026 David Engel.

Leeway is free software under the
[GNU Affero General Public License v3.0](LICENSE). You can use, change and
share it. If you run a changed version for other people over a network, you
must offer them its source code under the same license.
