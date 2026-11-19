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
  '/settings/appearance',
  '/settings/budgeting',
  '/settings/accounts',
  '/settings/banks',
  '/settings/email',
  '/settings/assistant',
  '/settings/data',
  '/settings/sign-in',
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
  await page.goto('/settings/accounts')
  await page.getByRole('button', { name: 'Delete Phone checking with a long name' }).click()
  await expect(page.getByRole('button', { name: /^Delete Phone checking/ })).toHaveCount(0)
})

test('Settings groups are a row of pills that scrolls sideways, not the page', async ({ page }) => {
  // An old address from when Settings was called Customize lands on its group.
  await page.goto('/customize#agent')
  await expect(page).toHaveURL(/\/settings\/assistant$/)
  const menu = page.getByRole('navigation', { name: 'Settings groups' })
  const assistant = menu.getByRole('link', { name: 'AI assistant' })
  await expect(assistant).toHaveAttribute('aria-current', 'page')
  // The open group's pill is scrolled into view, even when it sits far along the row.
  await expect(assistant).toBeInViewport()
  const row = await menu.evaluate((nav) => ({ scroll: nav.scrollWidth, shown: nav.clientWidth }))
  expect(row.scroll).toBeGreaterThan(row.shown)
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await menu.getByRole('link', { name: 'Sign-in' }).click()
  await expect(page).toHaveURL(/\/settings\/sign-in$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Sign-in' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Sign-in' })).toBeInViewport()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})
