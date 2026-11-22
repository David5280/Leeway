// A year exports for taxes from Settings, as a CSV with a short summary.

import { expect, test } from '@playwright/test'

test('a year exports for taxes from Settings', async ({ page }) => {
  await page.goto('/settings/data')
  const year = String(new Date().getFullYear() - 1)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: `Download ${year} CSV` }).click()
  expect((await download).suggestedFilename()).toBe(`leeway-${year}-tax-summary.csv`)
  await expect(page.getByText('Interest', { exact: true })).toBeVisible()
  await expect(page.getByText(/not tax advice/)).toBeVisible()
})
