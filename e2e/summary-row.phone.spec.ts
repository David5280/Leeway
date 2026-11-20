// On a phone the Budgets summary cards stack, and the ring beside the spent
// figure leaves that card no taller than the budgeted one.

import { expect, test } from '@playwright/test'
import { summaryHeights } from './summary-row'

test('the Budgets summary cards stack evenly on a phone', async ({ page }) => {
  const { Budgeted, Spent } = await summaryHeights(page)
  expect(Spent).toBe(Budgeted)
})
