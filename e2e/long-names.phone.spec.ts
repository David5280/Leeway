// Long names stay inside a phone screen: a long category ends in an ellipsis
// in a transaction's sheet, and a long unbroken description ends in an
// ellipsis on its row, and wraps in its sheet, instead of widening the page.

import { expect, test, type Locator } from '@playwright/test'
import { addAccount, addSpending, removeAccount } from './manual'
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
