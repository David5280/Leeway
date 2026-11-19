// On an iPhone installed to the home screen, the app draws under the status
// bar and the home indicator. Every screen keeps clear of both, with even
// 16px gutters, and long choices end in an ellipsis instead of being cut off.

import { expect, test, type Page } from '@playwright/test'
import { addAccount } from './manual'

const IPHONE = { viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true }
/** The narrowest phone still in use: an iPhone SE, first generation. */
const NARROWEST = { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }
const INSET = { top: 47, bottom: 34 }
const GUTTER = 16

/**
 * Stands in for an iPhone's safe-area insets. A browser test cannot fake
 * env(safe-area-inset-*), so this sets the CSS variables that styles.css
 * reads them through (--sat, --sab).
 */
async function simulateInsets(page: Page) {
  await page.addStyleTag({ content: `:root { --sat: ${INSET.top}px; --sab: ${INSET.bottom}px; }` })
}

/** How far the page is wider than the screen; above zero means it scrolls sideways. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** The left and right edges of every block on the page, in screen pixels. */
const blockEdges = (page: Page) =>
  page.locator('.page > *').evaluateAll((blocks) =>
    blocks
      .map((block) => block.getBoundingClientRect())
      .filter((box) => box.width > 0)
      .map((box) => ({ left: box.left, right: window.innerWidth - box.right })),
  )

test.describe('on an iPhone', () => {
  test.use(IPHONE)

  for (const path of ['/', '/accounts', '/transactions', '/budgets', '/plan', '/customize']) {
    test(`${path} clears the status bar and keeps 16px gutters`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await simulateInsets(page)

      const header = await page.getByRole('banner').boundingBox()
      expect(header!.y).toBeGreaterThanOrEqual(INSET.top)

      for (const edge of await blockEdges(page)) {
        expect(edge.left).toBeGreaterThanOrEqual(GUTTER)
        expect(edge.right).toBeGreaterThanOrEqual(GUTTER)
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  }

  test('the tab bar clears the home indicator and hides no content', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await simulateInsets(page)

    const tabbar = page.getByRole('navigation', { name: 'Main' })
    const lastTab = await tabbar.getByRole('link').last().boundingBox()
    expect(lastTab!.y + lastTab!.height).toBeLessThanOrEqual(IPHONE.viewport.height - INSET.bottom)

    // Scrolled to the very end, the last block sits above the tab bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const bar = await tabbar.boundingBox()
    const last = await page.locator('.page > *').last().boundingBox()
    expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y)
  })

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('the sign-in page keeps clear of the edges', async ({ page }) => {
      await page.goto('/')
      const form = page.getByRole('form', { name: 'Sign in' })
      await expect(form).toBeVisible()
      await simulateInsets(page)

      const box = await form.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(INSET.top)
      expect(box!.x).toBeGreaterThanOrEqual(GUTTER)
      expect(IPHONE.viewport.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(GUTTER)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
})

test.describe('on the narrowest phone', () => {
  test.use(NARROWEST)

  test('a long category name ends in an ellipsis inside its picker', async ({ page }) => {
    await addAccount(page, { name: 'Ellipsis checking', balance: '100' })
    await page.goto('/transactions')
    await page.getByRole('button', { name: 'Add by hand' }).click()
    const form = page.getByRole('form', { name: 'Add a transaction' })
    await form.getByRole('textbox', { name: 'Description' }).fill('Music app')
    await form.getByRole('textbox', { name: 'Amount' }).fill('10.99')
    await form.getByRole('combobox', { name: 'Account' }).selectOption('Ellipsis checking')
    await form.getByRole('combobox', { name: 'Category' }).selectOption('Streaming and apps')
    await form.getByRole('button', { name: 'Add' }).click()

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

    // Removed again, so the other tests see the install as before.
    await page.goto('/customize#accounts')
    await page.getByRole('button', { name: 'Delete Ellipsis checking' }).click()
    await expect(page.getByRole('button', { name: 'Delete Ellipsis checking' })).toHaveCount(0)
  })
})
