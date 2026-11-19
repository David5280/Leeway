# Security policy

Leeway holds people's bank connections, so security reports are taken
seriously and answered quickly.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. Open the repository's **Security** tab on GitHub.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do
   with it.

GitHub keeps the report private between you and the maintainer. You should
hear back within a week. Once a fix is released, the advisory is published
with credit to you, unless you would rather stay anonymous.

## Supported versions

Only the latest version on the `main` branch gets security fixes. Keep your
install up to date (see "Updating and backups" in the README).

## What counts

Anything that lets someone read or change another person's data, sign in
without the password, claim a new install without its setup code, or reach
bank access tokens. Problems that need someone to already control the server,
the database or `ENCRYPTION_KEY` are out of scope, since those already hold
everything.
