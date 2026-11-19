// Long names stay inside a phone screen: a long category ends in an ellipsis
// in its picker, and a long unbroken description wraps instead of widening
// the page.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { addAccount, removeAccount } from './manual'
import { IPHONE, NARROWEST, overflow } from './phone'

/** Adds spending by hand to the named account. */
async function addSpending(
  page: Page,
  spending: { account: string; description: string; category?: string },
) {
  await page.goto('/transactions')
  await page.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('form', { name: 'Add a transaction' })
  await form.getByRole('textbox', { name: 'Description' }).fill(spending.description)
  await form.getByRole('textbox', { name: 'Amount' }).fill('10.99')
  await form.getByRole('combobox', { name: 'Account' }).selectOption(spending.account)
  if (spending.category) {
    await form.getByRole('combobox', { name: 'Category' }).selectOption(spending.category)
  }
  await form.getByRole('button', { name: 'Add' }).click()
}

/** Checks that text wraps inside the page's 16px gutters rather than spilling past its card. */
async function expectInsideGutters(text: Locator) {
  const box = await text.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(IPHONE.viewport.width - 16)
}

test.describe('on the narrowest phone', () => {
  test.use(NARROWEST)

  test('a long category name ends in an ellipsis inside its picker', async ({ page }) => {
    await addAccount(page, { name: 'Ellipsis checking', balance: '100' })
    await addSpending(page, {
      account: 'Ellipsis checking',
      description: 'Music app',
      category: 'Streaming and apps',
    })

    const picker = page.getByRole('combobox', { name: 'Category for Music app' })
    await expect(picker).toHaveValue(/.+/)
    const fit = await picker.evaluate((select: HTMLSelectElement) => {
      const style = getComputedStyle(select)
      // The chosen name's width in the picker's own font, against the room left
      // for text once the padding (and the chevron inside it) is taken out.
      const context = document.createElement('canvas').getContext('2d')!
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const text = context.measureText(select.selectedOptions[0]!.text).width
      const room =
        select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const box = select.getBoundingClientRect()
      return {
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        truncated: text > room,
        inside: box.left >= 0 && box.right <= window.innerWidth,
      }
    })
    expect(fit).toEqual({
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      truncated: true,
      inside: true,
    })
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await removeAccount(page, 'Ellipsis checking')
  })
})

test.describe('on an iPhone', () => {
  test.use(IPHONE)

  test('a long unbroken description wraps inside the screen', async ({ page }) => {
    // 120 characters with no space, like a bank's reference code.
    const description = 'REF'.padEnd(120, '0123456789')
    await addAccount(page, { name: 'Unbroken checking', balance: '100' })
    await addSpending(page, { account: 'Unbroken checking', description })

    const list = page.getByRole('region', { name: 'Transaction list' })
    const name = list.getByText(description)
    await expect(name).toBeVisible()
    // The name wraps inside the screen rather than spilling past its card.
    await expectInsideGutters(name)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    // The overview's recent list shows it too.
    await page.goto('/')
    const recent = page.getByRole('region', { name: 'Recent transactions' }).getByText(description)
    await expect(recent).toBeVisible()
    await expectInsideGutters(recent)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await removeAccount(page, 'Unbroken checking')
  })
})
