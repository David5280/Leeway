// On a phone every screen fits the width, and the main menu is in reach.

import { expect, test, type Page } from '@playwright/test'
import { addAccount } from './manual'

/** How far the page is wider than the screen; above zero means it scrolls sideways. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const path of [
  '/',
  '/accounts',
  '/alerts',
  '/transactions',
  '/budgets',
  '/plan',
  '/customize',
]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })
}

test('an account alert and its account fit a phone screen', async ({ page }) => {
  await addAccount(page, { name: 'Phone checking with a long name', balance: '-1234.56' })

  await page.goto('/')
  const banner = page.getByRole('region', { name: 'Account alerts' })
  await expect(banner).toContainText('is overdrawn by $1,234.56.')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await banner.getByRole('link', { name: /Phone checking with a long name is overdrawn/ }).click()
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('-$1,234.56')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // Removed again, so the other tests see the install as before.
  await page.goto('/customize#accounts')
  await page.getByRole('button', { name: 'Delete Phone checking with a long name' }).click()
  await expect(page.getByRole('button', { name: /^Delete Phone checking/ })).toHaveCount(0)
})
