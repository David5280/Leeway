// On an iPhone installed to the home screen, the app draws under the status
// bar, the home indicator and, sideways, the Dynamic Island. Every screen
// keeps clear of them, with even 16px gutters inside the safe area.

import { expect, test, type Page } from '@playwright/test'
import {
  IPHONE,
  IPHONE_LANDSCAPE,
  overflow,
  SIDEWAYS_INSETS,
  simulateInsets,
  UPRIGHT_INSETS,
} from './phone'

const GUTTER = 16
const SCREENS = ['/', '/accounts', '/transactions', '/budgets', '/plan', '/customize']

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

  for (const path of SCREENS) {
    test(`${path} clears the status bar and keeps 16px gutters`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await simulateInsets(page, UPRIGHT_INSETS)

      const header = await page.getByRole('banner').boundingBox()
      expect(header!.y).toBeGreaterThanOrEqual(UPRIGHT_INSETS.top)

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
    await simulateInsets(page, UPRIGHT_INSETS)

    const tabbar = page.getByRole('navigation', { name: 'Main' })
    const lastTab = await tabbar.getByRole('link').last().boundingBox()
    expect(lastTab!.y + lastTab!.height).toBeLessThanOrEqual(
      IPHONE.viewport.height - UPRIGHT_INSETS.bottom,
    )

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
      await simulateInsets(page, UPRIGHT_INSETS)

      const box = await form.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(UPRIGHT_INSETS.top)
      expect(box!.x).toBeGreaterThanOrEqual(GUTTER)
      expect(IPHONE.viewport.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(GUTTER)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
})

test.describe('on an iPhone turned sideways', () => {
  test.use(IPHONE_LANDSCAPE)

  for (const path of SCREENS) {
    test(`${path} keeps its gutters clear of the side insets`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await simulateInsets(page, SIDEWAYS_INSETS)

      for (const edge of await blockEdges(page)) {
        expect(edge.left).toBeGreaterThanOrEqual(SIDEWAYS_INSETS.left + GUTTER)
        expect(edge.right).toBeGreaterThanOrEqual(SIDEWAYS_INSETS.right + GUTTER)
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  }
})
