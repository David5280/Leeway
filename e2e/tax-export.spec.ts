// A year exports for taxes from Settings, as a CSV with a short summary.

import { expect, test } from '@playwright/test'

test('a year exports for taxes from Settings', async ({ page }) => {
  await page.goto('/settings/data')
  // The year comes from the app, which picks last year in its own time zone,
  // never from this machine's clock, which may already be in another year.
  const year = await page.getByRole('combobox', { name: 'Tax year' }).inputValue()
  expect(year).toMatch(/^\d{4}$/)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: `Download ${year} CSV` }).click()
  expect((await download).suggestedFilename()).toBe(`leeway-${year}-tax-summary.csv`)
  // The seed spends in the current period, so last year may hold nothing, which says so.
  const summed = page.getByText('Interest', { exact: true })
  await expect(summed.or(page.getByText(`No transactions in ${year}.`))).toBeVisible()
  await expect(page.getByText(/not tax advice/)).toBeVisible()
})
