// A row of summary cards lines up: the Budgets row's cards are as tall as one
// another, so none leaves dead space beside a taller one. Shared by the
// desktop and phone specs.

import { expect, type Page } from '@playwright/test'

/** The heights of the Budgets summary cards, by label. */
export async function summaryHeights(page: Page): Promise<Record<string, number>> {
  await page.goto('/spending')
  const heights: Record<string, number> = {}
  for (const label of ['Budgeted', 'Spent', 'Left']) {
    const card = page.getByRole('region', { name: label, exact: true })
    await expect(card).toBeVisible()
    heights[label] = Math.round((await card.boundingBox())!.height)
  }
  return heights
}
