// On a phone every screen fits the width, and the main menu is in reach.

import { expect, test } from '@playwright/test'

for (const path of ['/', '/transactions', '/budgets', '/plan', '/customize']) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
