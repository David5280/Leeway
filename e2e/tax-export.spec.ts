// A year exports for taxes from Settings, as a CSV with a short summary.

import { expect, test } from '@playwright/test'
import { action, addLastYearInterest } from './seed'

let accountId = ''

// A year with nothing in it says so instead of summing, so last year gets a deposit.
test.beforeAll(async ({ request }) => {
  accountId = await addLastYearInterest(request)
})

// Deleting the account deletes its transactions, so the install is as it was.
test.afterAll(async ({ request }) => {
  if (accountId) await action(request, 'delete_account', { id: accountId })
})

test('a year exports for taxes from Settings', async ({ page }) => {
  await page.goto('/settings/data')
  // The year comes from the app, which picks last year in its own time zone,
  // never from this machine's clock, which may already be in another year.
  const year = await page.getByRole('combobox', { name: 'Tax year' }).inputValue()
  expect(year).toMatch(/^\d{4}$/)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: `Download ${year} CSV` }).click()
  expect((await download).suggestedFilename()).toBe(`leeway-${year}-tax-summary.csv`)
  await expect(page.getByText('Interest', { exact: true })).toBeVisible()
  await expect(page.getByText(/not tax advice/)).toBeVisible()
})
