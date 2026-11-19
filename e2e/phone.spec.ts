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
  // Its edges fade, so a pill cut off there reads as more to scroll to.
  const mask = await menu.evaluate((nav) => getComputedStyle(nav).maskImage)
  expect(mask).toContain('linear-gradient')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await menu.getByRole('link', { name: 'Sign-in' }).click()
  await expect(page).toHaveURL(/\/settings\/sign-in$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Sign-in' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Sign-in' })).toBeInViewport()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('setting controls sit in even rows under their labels', async ({ page }) => {
  await page.goto('/settings/appearance')
  await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
  // Each control's options, by how many share each row: never one left on a row alone.
  const rows = await page.locator('.seg').evaluateAll((controls) =>
    controls.map((control) => {
      const tops = [...control.querySelectorAll('button')].map((b) => b.offsetTop)
      const counts = new Map<number, number>()
      for (const top of tops) counts.set(top, (counts.get(top) ?? 0) + 1)
      return [...counts.values()]
    }),
  )
  expect(rows.length).toBeGreaterThan(5)
  for (const counts of rows) expect(new Set(counts).size).toBe(1)

  // "Light or dark" sits under its label, the full width of the card.
  const mode = page.getByRole('group', { name: 'Light or dark' })
  const label = page.getByText('Each theme has both')
  const [modeBox, labelBox] = [await mode.boundingBox(), await label.boundingBox()]
  expect(modeBox!.y).toBeGreaterThan(labelBox!.y)
})

test('dashboard rows shorten a long name with an ellipsis rather than clipping it', async ({
  page,
}) => {
  await page.goto('/settings/appearance#layout')
  const names = page.locator('.layout-row .ellipsis')
  await expect(names.first()).toBeVisible()
  const styles = await names.evaluateAll((spans) =>
    spans.map((span) => {
      const style = getComputedStyle(span)
      return `${style.textOverflow} ${style.whiteSpace}`
    }),
  )
  expect(new Set(styles)).toEqual(new Set(['ellipsis nowrap']))
  // Each widget's name has room beside its switch and move buttons, size control below.
  const shown = await names.evaluateAll((spans) =>
    spans.filter((span) => span.scrollWidth <= span.clientWidth).map((span) => span.textContent),
  )
  expect(shown).toContain('Spending pace')
  expect(shown).toContain('Categories')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})
