// Settings > Widget on a phone: it stays inside the screen, nothing sits on
// top of anything else, and every control is at least 44px tall, from an
// iPhone at 390px down to the narrowest phone and turned sideways.

import { expect, test } from '@playwright/test'
import { boxes, overflow, overlapping, PHONES } from './phone'
import {
  deployedAt,
  makeWidgetToken,
  revokeWidgetToken,
  SCREENSHOTS,
  showPlaceholderToken,
} from './widget'

for (const [name, viewport] of PHONES) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })
    test.afterEach(async ({ page }) => revokeWidgetToken(page))

    test('the widget setup fits, with nothing overlapping and 44px targets', async ({ page }) => {
      await deployedAt(page, 'https://leeway.example.com')
      await showPlaceholderToken(page)
      await makeWidgetToken(page)
      const section = page.getByRole('region', { name: 'Widget' })
      await expect(section.getByRole('button', { name: 'Copy the script' })).toBeEnabled()

      expect(await overflow(page)).toBeLessThanOrEqual(0)

      const controls = section.locator('button, a.btn')
      const sizes = await boxes(controls)
      expect(sizes.length).toBeGreaterThanOrEqual(5)
      for (const box of sizes) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      }
      // Controls, the parameter and the text around them each keep their own space.
      const parts = await boxes(section.locator('button, a.btn, code, h3, li, p'))
      for (const [i, a] of parts.entries()) {
        for (const b of parts.slice(i + 1)) expect(overlapping(a, b)).toBe(false)
      }

      if (SCREENSHOTS && viewport.width === 390) {
        // As tall as the page, so the fixed tab bar sits at the bottom rather than over it.
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width: 390, height })
        await page.screenshot({ path: `${SCREENSHOTS}/settings-widget-iphone-390.png` })
      }
    })
  })
}
