// On a phone every screen fits the width, and the main menu is in reach.

import { expect, test, type Page } from '@playwright/test'
import { addAccount } from './manual'

/** How far the page is wider than the screen; above zero means it scrolls sideways. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

const PATHS = [
  '/',
  '/wealth',
  '/inbox',
  '/spending/activity',
  '/spending',
  '/payday',
  '/goals',
  '/wealth/retirement',
  '/settings/appearance',
  '/settings/budgeting',
  '/settings/accounts',
  '/settings/banks',
  '/settings/email',
  '/settings/assistant',
  '/settings/data',
  '/settings/sign-in',
]

/** Loads a screen and checks it fits the width. */
async function fits(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
}

for (const path of PATHS) {
  test(`${path} fits a phone screen`, async ({ page }) => fits(page, path))
}

// The project's phone is a 412px Pixel 7; many phones are narrower.
for (const width of [390, 320]) {
  test.describe(`a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 700 } })

    for (const path of PATHS) {
      test(`${path} fits`, async ({ page }) => fits(page, path))
    }

    test('a setting with a long list spans the card under its label, no wider', async ({
      page,
    }) => {
      await page.goto('/settings/budgeting#region')
      const zone = page.getByRole('combobox', { name: 'Time zone' })
      const card = page.getByRole('region', { name: 'Region' })
      const [zoneBox, cardBox] = [await zone.boundingBox(), await card.boundingBox()]
      expect(zoneBox!.x).toBeGreaterThanOrEqual(cardBox!.x)
      expect(zoneBox!.x + zoneBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })

    test("the email's day and hour share the card's width, and its setup names stay whole", async ({
      page,
    }) => {
      await page.goto('/settings/email')
      const card = (await page.getByRole('region', { name: 'Email' }).boundingBox())!
      for (const name of ['Day', 'Hour']) {
        const list = (await page.getByRole('combobox', { name }).boundingBox())!
        expect(list.x).toBeGreaterThanOrEqual(card.x)
        expect(list.x + list.width).toBeLessThanOrEqual(card.x + card.width)
      }
      // A name like RESEND_API_KEY moves to the next line whole, never split across two.
      const names = page.getByRole('region', { name: 'Email' }).locator('code')
      await expect(names.first()).toBeVisible()
      const lines = await names.evaluateAll((codes) =>
        codes.map((code) => `${code.textContent} ${code.getClientRects().length}`),
      )
      expect(lines).toEqual(['RESEND_API_KEY 1', 'MAIL_FROM 1', 'MAIL_FROM 1'])
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })

    test('each Settings pill the keyboard reaches is in full view, clear of the fade', async ({
      page,
    }) => {
      await page.goto('/settings/appearance')
      const pills = page.getByRole('navigation', { name: 'Settings groups' }).getByRole('link')
      await pills.first().focus()
      const count = await pills.count()
      for (let index = 0; index < count; index++) {
        if (index > 0) await page.keyboard.press('Tab')
        const pill = pills.nth(index)
        await expect(pill).toBeFocused()
        // Wait for the row to settle, then check the pill sits inside the 16px fades.
        await expect(async () => {
          const box = (await pill.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(16)
          expect(box.x + box.width).toBeLessThanOrEqual(width - 16)
        }).toPass({ timeout: 2000 })
      }
    })
  })
}

test('an account alert and its account fit a phone screen', async ({ page }) => {
  await addAccount(page, { name: 'Phone checking with a long name', balance: '-1234.56' })

  await page.goto('/')
  const headsUp = page.getByRole('region', { name: 'Heads up' })
  await expect(headsUp).toContainText('is overdrawn by $1,234.56.')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await headsUp.getByRole('link', { name: /Phone checking with a long name is overdrawn/ }).click()
  // The alert opens the account's own page, which leads with the overdraft.
  await expect(
    page.getByRole('region', { name: 'Phone checking with a long name balance' }),
  ).toContainText(/Overdrawn by\s*\$1,234\.56/)
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
  expect(shown).toContain('Your top goal')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})
