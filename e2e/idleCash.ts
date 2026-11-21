// A stand-in for get_idle_cash in the browser tests: spare cash is shown
// only when checking holds far more than it needs, which the shared test
// install can't promise, so its answer is given here instead.

import type { Page } from '@playwright/test'
import { checkIdleCash } from '../server/src/domain/idleCash'

/** The server's own answer for a large checking balance well past its needs. */
export const SPARE_CASH = checkIdleCash({
  checkingCents: 145_678_900,
  billsCents: 120_000,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-12-01',
  overdrawn: false,
  tight: false,
})

/** Answers get_idle_cash with SPARE_CASH, so Plan, Bills shows its card. */
export async function fakeSpareCash(page: Page): Promise<void> {
  await page.route('**/api/actions/get_idle_cash', (route) =>
    route.fulfill({ json: { result: SPARE_CASH } }),
  )
}
