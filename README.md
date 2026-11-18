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
database, generates an encryption key and a setup code, and gives Leeway a
public address. The database is set up automatically, and again on every
upgrade.

1. Click **Deploy on Railway** and sign in to Railway, or make an account.
2. Railway lists Leeway's settings. Every one is already filled in or
   optional, so choose **Deploy** without changing anything. (The table under
   [Publishing the Railway template](#publishing-the-railway-template) says
   what each one is.)
3. When the deploy finishes, open the address shown on the Leeway service. It
   ends in `.up.railway.app`.
4. The first screen asks for a setup code, so nobody else who finds the
   address can claim your Leeway. The screen says where it is: on the Leeway
   service, open **Variables** and copy `SETUP_CODE`.
5. Create your sign-in and follow the setup screens. Bank sync is optional:
   skip it, and the last screen shows you how to import a CSV file from your
   bank or add accounts by hand.
6. Copy `ENCRYPTION_KEY` from the same **Variables** tab and keep it somewhere
   safe, like a password manager. Without it, connected banks have to be
   linked again.
7. Whenever you like, turn on bank sync (see [Bank sync](#bank-sync-plaid)).

If a required setting is missing, the deploy log says which one, what to set
it to and where.

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
5. Open that address. The first screen asks for a setup code and says where
   it is: click the Leeway service's latest deployment, open **Deploy Logs**
   and copy the code from the newest line that starts `No account yet`.
   Leeway makes a new one each time it starts. To choose your own instead,
   set `SETUP_CODE` (12 characters or more) in **Variables**.
6. Create your sign-in and follow the setup screens.

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

| Variable          | Value                                                | Description to show                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`                         | Required, filled in for you. Connects Leeway to the PostgreSQL database this template creates. Leave it as is.                                                                                         |
| `ENCRYPTION_KEY`  | `${{secret(64, "abcdef0123456789")}}`                | Required, generated for you. Locks your bank connections. After deploying, copy it from Variables and keep it somewhere safe: without it, connected banks must be linked again.                        |
| `SETUP_CODE`      | `${{secret(16, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")}}` | Generated for you. A one-time code that proves this Leeway is yours. Leeway's first screen asks for it and says where it is: here, in Variables.                                                       |
| `PLAID_CLIENT_ID` | empty, optional                                      | Optional, for bank sync. Leave empty to start: Leeway works without it, with CSV imports and accounts added by hand. Later, paste the client_id from dashboard.plaid.com, under Developers, then Keys. |
| `PLAID_SECRET`    | empty, optional                                      | Optional, for bank sync. Leave empty to start. Later, paste a secret from the same Plaid page: the Sandbox secret for test banks, or the Production secret for real ones.                              |
| `PLAID_ENV`       | `sandbox`                                            | Optional. Leave as sandbox, Plaid's pretend test banks. Change to production once Plaid gives you Production access for real banks (see Bank sync in Leeway's README).                                 |

The build (`Dockerfile`) and the health check (`/api/health`) come from
`railway.json` in the repository, so they need no setting in the template.

### Option 2: Docker on your own machine

You need [Docker](https://docs.docker.com/get-docker/) with Compose
(Docker Desktop includes both) and `git`.

1. Get the code and go into its folder:
   ```sh
   git clone https://github.com/<you>/leeway.git && cd leeway
   ```
2. Make your settings file from the example:
   ```sh
   cp .env.example .env
   ```
3. Open `.env` and set `ENCRYPTION_KEY` to 64 random hex characters.
   `openssl rand -hex 32` prints one. Keep a copy somewhere safe. Everything
   else can stay empty for now.
4. Start Leeway and its database:
   ```sh
   docker compose up -d
   ```
5. Open http://localhost:3000. The first screen asks for a setup code and
   says where it is. If you set `SETUP_CODE` in `.env`, it is that. If not,
   run `docker compose logs leeway` and copy the code from the newest line
   that starts `No account yet` (Leeway makes a new one each time it starts).
6. Create your sign-in and follow the setup screens.

The database lives in a Docker volume, so it survives restarts and upgrades.
After changing `.env`, run `docker compose up -d` again to apply it. To
upgrade, pull the latest code and run `docker compose up -d --build`.

### Option 3: From source

You need Node.js 22.12 or newer and PostgreSQL.

```sh
npm install
cp .env.example .env   # set DATABASE_URL and ENCRYPTION_KEY
npm run build
npm start
```

The setup screen asks for a setup code: `SETUP_CODE` from `.env` if you set
one, or else the code at the end of the line Leeway prints at startup that
starts `No account yet`.

## Server settings

The server is configured with environment variables; everything else is
chosen in the app, under **Customize**. `.env.example` lists them with notes.

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
| `DATABASE_SSL`          | No       | `true` or `false`; by default TLS for any non-local database |
| `PORT`                  | No       | The port Leeway listens on, default 3000                     |
| `HOST`                  | No       | The address Leeway listens on, default `0.0.0.0`             |

On Railway, `PUBLIC_URL` is filled in from the generated domain automatically.

### Bank sync (Plaid)

Bank sync is optional. Without it, import CSV files from your bank
(**Transactions**, then **Import**) or add accounts by hand (**Customize**,
then **Accounts**). [Plaid](https://plaid.com) is the service many budgeting
apps use to connect to banks; Leeway uses it only to read balances and
transactions, and nothing can move money.

1. Make a free account at [dashboard.plaid.com](https://dashboard.plaid.com).
2. Open **Developers**, then
   [**Keys**](https://dashboard.plaid.com/developers/keys), and copy your
   `client_id` and your **Sandbox** secret. Plaid gives each environment its
   own secret.
3. Set `PLAID_CLIENT_ID` and `PLAID_SECRET` where Leeway runs: on Railway, in
   the Leeway service's **Variables**, then deploy the change; with Docker, in
   `.env`, then `docker compose up -d`. Keys are server settings, so the app
   never asks for them.
4. In Leeway, open **Customize**, then **Banks**, and choose **Connect a
   bank**.

**Sandbox has only test banks.** Sandbox keys show Plaid's pretend banks; sign
in to any of them with `user_good` and password `pass_good`. Your real bank
needs Production access from Plaid:

- **In the US and Canada**, Plaid teams created on or after April 15, 2026 can
  use the free **Trial plan**: real banks, up to 10 bank logins, with
  Transactions and Balance included. Removing a bank does not free its spot.
  You apply when you sign up; Plaid approves most applications automatically
  after an identity check and answers flagged ones by email within 2 to 3
  business days.
- **Anywhere else, or for more banks**, choose **Get production access** in
  the Plaid dashboard. It asks about your business, the products you need and
  who owns the business, and has you pick a paid plan. Plaid says approval takes a couple of
  business days.

Once approved, set `PLAID_ENV` to `production` and `PLAID_SECRET` to your
**Production** secret, the same way as the keys.

Sources: Plaid's
[Sandbox overview](https://plaid.com/docs/sandbox/),
[What is the Plaid Trial plan](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan),
[How are Sandbox, Production, Trial plan and Limited Production different](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different)
and
[How do I upgrade from the Trial plan to a paid Production plan](https://support.plaid.com/hc/en-us/articles/39917307426967-How-do-I-upgrade-from-the-Trial-plan-to-a-paid-Production-plan),
read November 2026.

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

## Backups and recovery

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
  passwords in 15 minutes. Creating the account takes a one-time setup code
  (`SETUP_CODE`, or one printed in the server log), so nobody who finds a new
  install first can claim it. Wrong codes pause setup the same way.
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
