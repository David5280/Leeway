// On an iPhone installed to the home screen, the app draws under the status
// bar, the home indicator and, sideways, the Dynamic Island. Every screen
// keeps clear of them, with even 16px gutters inside the safe area.

import { expect, test, type Page } from '@playwright/test'
import { smallFields } from './fields'
import {
  IPHONE,
  IPHONE_LANDSCAPE,
  overflow,
  SIDEWAYS_INSETS,
  simulateInsets,
  UPRIGHT_INSETS,
} from './phone'

const GUTTER = 16
const SCREENS = [
  '/',
  '/accounts',
  '/transactions',
  '/budgets',
  '/plan',
  // Settings runs its pill row edge to edge, so its gutters are worth a look.
  '/settings/appearance',
  '/settings/accounts',
]

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
      // Wider than the phone layout, but still a touch screen that zooms on small fields.
      expect(await smallFields(page)).toEqual([])
    })
  }
})

test.describe('the status bar backdrop', () => {
  const backdrop = (page: Page) => page.locator('.status-backdrop')

  /**
   * The backdrop's fill and the page's background, each as the red, green,
   * blue and alpha a screen would draw (0 to 255). Painting each color on a
   * canvas reads modern color syntax, like color-mix(), the same way.
   */
  const fills = (page: Page) =>
    page.evaluate(() => {
      const canvas = document.createElement('canvas').getContext('2d')!
      const pixel = (color: string) => {
        canvas.clearRect(0, 0, 1, 1)
        canvas.fillStyle = color
        canvas.fillRect(0, 0, 1, 1)
        return [...canvas.getImageData(0, 0, 1, 1).data]
      }
      const backdrop = document.querySelector('.status-backdrop')!
      return {
        backdrop: pixel(getComputedStyle(backdrop).backgroundColor),
        page: pixel(getComputedStyle(document.body).backgroundColor),
      }
    })

  test.describe('on an iPhone', () => {
    test.use(IPHONE)

    test('covers exactly the status bar and lets taps through', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await simulateInsets(page, UPRIGHT_INSETS)

      expect(await backdrop(page).boundingBox()).toEqual({
        x: 0,
        y: 0,
        width: IPHONE.viewport.width,
        height: UPRIGHT_INSETS.top,
      })
      await expect(backdrop(page)).toHaveCSS('position', 'fixed')
      await expect(backdrop(page)).toHaveCSS('pointer-events', 'none')
      await expect(backdrop(page)).toHaveAttribute('aria-hidden', 'true')
    })

    // Each theme in each mode, set on the way to the page so the install keeps its own look.
    for (const theme of ['night', 'harbor', 'neon']) {
      for (const mode of ['dark', 'light']) {
        test(`is filled with the page background in ${theme}, ${mode}`, async ({ page }) => {
          await page.route('**/api/actions/get_settings', async (route) => {
            const { result } = await (await route.fetch()).json()
            await route.fulfill({
              json: { result: { ...result, appearance: { ...result.appearance, theme, mode } } },
            })
          })
          await page.goto('/')
          await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
          await simulateInsets(page, UPRIGHT_INSETS)

          const { backdrop, page: background } = await fills(page)
          // The same color, nearly opaque, so the clock reads over any scrolled text.
          // A see-through pixel's channels round to the nearest step, so allow one.
          backdrop.slice(0, 3).forEach((value, channel) => {
            expect(Math.abs(value - background[channel]!)).toBeLessThanOrEqual(1)
          })
          expect(backdrop[3]).toBeGreaterThanOrEqual(0.9 * 255)
          expect(background[3]).toBe(255)
        })
      }
    }
  })

  test('folds away when the phone is turned sideways', async ({ page }) => {
    await page.setViewportSize(IPHONE_LANDSCAPE.viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await simulateInsets(page, SIDEWAYS_INSETS)
    expect((await backdrop(page).boundingBox())?.height ?? 0).toBe(0)
  })

  test('takes no room on a computer, which has no status bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect((await backdrop(page).boundingBox())?.height ?? 0).toBe(0)
  })
})
