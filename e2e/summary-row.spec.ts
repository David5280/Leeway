// On a wide screen the Budgets summary cards sit side by side, all one height.

import { expect, test } from '@playwright/test'
import { summaryHeights } from './summary-row'

test('the Budgets summary cards are all one height, the ring beside its figure', async ({
  page,
}) => {
  const { Budgeted, Spent, Left } = await summaryHeights(page)
  expect(Spent).toBe(Budgeted)
  expect(Left).toBe(Budgeted)
  // The ring is no taller than the figure it sits beside.
  const spent = page.getByRole('region', { name: 'Spent', exact: true })
  const ring = (await spent.getByRole('progressbar').boundingBox())!
  const figure = (await spent.locator('.mid-number').boundingBox())!
  expect(ring.height).toBeLessThanOrEqual(figure.height)
  expect(Math.abs(ring.y + ring.height / 2 - (figure.y + figure.height / 2))).toBeLessThanOrEqual(2)
})
