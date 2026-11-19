// Long names stay inside a phone screen: a long category ends in an ellipsis
// in a transaction's sheet, and a long unbroken description ends in an
// ellipsis on its row, and wraps in its sheet, instead of widening the page.
// A category far over budget on the overview's Categories widget keeps a short
// name whole beside its figures rather than squeeze it to a letter or two.

import { expect, test, type Locator } from '@playwright/test'
import { action, addAccount, addSpending, removeAccount } from './manual'
import { IPHONE, NARROWEST, overflow } from './phone'

/** Checks that text stays inside the page's 16px gutters rather than spilling past its card. */
async function expectInsideGutters(text: Locator, screenWidth: number) {
  const box = await text.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(16)
  expect(box!.x + box!.width).toBeLessThanOrEqual(screenWidth - 16)
}

/** How a single line of text is set: cut short with an ellipsis, and whether it had to be. */
const lineFit = (text: Locator) =>
  text.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element)
    return {
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      truncated: element.scrollWidth > element.clientWidth,
    }
  })

test.describe('on the narrowest phone', () => {
  test.use(NARROWEST)

  test("a long category name ends in an ellipsis in a transaction's sheet", async ({ page }) => {
    await addAccount(page, { name: 'Ellipsis checking', balance: '100' })
    await addSpending(page, {
      account: 'Ellipsis checking',
      description: 'Music app',
      amount: '10.99',
      category: 'Streaming and apps',
    })

    await page.getByRole('button', { name: /^Music app, spent/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Music app' })
    const name = sheet.locator('.sheet-choice-name')
    await expect(name).toHaveText('Streaming and apps')
    expect(await lineFit(name)).toMatchObject({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    const box = await sheet.getByRole('button', { name: /Streaming and apps/ }).boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(NARROWEST.viewport.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await page.keyboard.press('Escape')
    await removeAccount(page, 'Ellipsis checking')
  })

  test('a category far over budget keeps its name whole beside its figures', async ({ page }) => {
    // Four letters, far over a small budget: the widest figures a bar shows.
    const kite = await action<{ id: string }>(page, 'create_category', {
      name: 'Kite',
      budgetCents: 1_000,
    })
    await addAccount(page, { name: 'Status checking', balance: '20000' })
    await addSpending(page, {
      account: 'Status checking',
      description: 'Kite shop',
      amount: '12345.67',
      category: 'Kite',
    })

    await page.goto('/')
    const row = page
      .getByRole('region', { name: 'Categories', exact: true })
      .locator('.cbar')
      .filter({ has: page.locator('.cbar-name', { hasText: /^Kite$/ }) })
    const figures = row.locator('.cbar-figures')
    // The budget is shared out over the period, so the exact figure moves day to day.
    await expect(figures).toHaveText(/^Over\s*\$12,\d{3} of \$\d+/)

    // The name is whole, not cut to "K…", and the figures stay on the screen.
    expect(await lineFit(row.locator('.cbar-name'))).toMatchObject({ truncated: false })
    await expectInsideGutters(figures, NARROWEST.viewport.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await removeAccount(page, 'Status checking')
    await action(page, 'delete_category', { id: kite.id })
  })
})

test.describe('on an iPhone', () => {
  test.use(IPHONE)

  test('a long unbroken description ends in an ellipsis inside the screen', async ({ page }) => {
    // 120 letters with no space. (Digits would be read as a reference number and dropped.)
    const description = 'Ref'.padEnd(120, 'abcdefghij')
    await addAccount(page, { name: 'Unbroken checking', balance: '100' })
    await addSpending(page, { account: 'Unbroken checking', description, amount: '10.99' })

    const list = page.getByRole('region', { name: 'Transaction list' })
    const name = list.getByText(description)
    await expect(name).toBeVisible()
    expect(await lineFit(name)).toEqual({
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      truncated: true,
    })
    await expectInsideGutters(name, IPHONE.viewport.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    // In its sheet, the text as written wraps inside the screen.
    await name.click()
    const sheet = page.getByRole('dialog', { name: description })
    await sheet.getByText('Bank details').click()
    const raw = sheet.locator('.bank-raw').first()
    await expect(raw).toHaveText(description)
    await expectInsideGutters(raw, IPHONE.viewport.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')

    // The overview's recent list cuts it short too.
    await page.goto('/')
    const recent = page.getByRole('region', { name: 'Recent transactions' }).getByText(description)
    await expect(recent).toBeVisible()
    await expectInsideGutters(recent, IPHONE.viewport.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await removeAccount(page, 'Unbroken checking')
  })
})
