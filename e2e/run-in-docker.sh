#!/usr/bin/env bash
# Runs the browser tests inside Playwright's official image, for machines
# without Playwright's browsers installed. Uses the host's network and Postgres.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('@playwright/test/package.json').version")
docker run --rm --network host --ipc host \
  -v "$PWD":/work -w /work \
  -e E2E_DATABASE_URL -e E2E_PORT -e CI \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  npx playwright test "$@"
