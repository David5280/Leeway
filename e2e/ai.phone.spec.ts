// Settings > AI models on a phone: it stays inside the screen, nothing sits
// on top of anything else, and every control is at least 44px tall, from an
// iPhone at 390px down to the narrowest phone and turned sideways.

import { expect, test, type Locator } from '@playwright/test'
import { openAiModels, pretendBusyMonth, resetAi, SCREENSHOTS } from './ai'
import { overflow } from './phone'

const PHONES = [
  ['an iPhone 390px across', { width: 390, height: 844 }],
  ['an iPhone 375px across', { width: 375, height: 667 }],
  ['the narrowest phone', { width: 320, height: 568 }],
  ['an iPhone turned sideways', { width: 844, height: 390 }],
] as const

/** Every element's box, so overlaps and sizes can be checked. */
async function boxes(elements: Locator) {
  const all = await elements.all()
  return Promise.all(all.map(async (element) => (await element.boundingBox())!))
}

type Box = Awaited<ReturnType<typeof boxes>>[number]

/** Whether two boxes share any area; touching edges do not count. */
const overlapping = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5

for (const [name, viewport] of PHONES) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })
    test.afterEach(async ({ page }) => resetAi(page))

    test('AI models fits, with nothing overlapping and 44px targets', async ({ page }) => {
      await pretendBusyMonth(page)
      const section = await openAiModels(page)
      await expect(section.getByRole('group', { name: 'Paystub reader' })).toBeVisible()

      expect(await overflow(page)).toBeLessThanOrEqual(0)

      // Every control is big enough for a thumb, and inside the screen.
      const controls = await boxes(
        section.locator('button, input:not([type=radio]), label.model-choice'),
      )
      expect(controls.length).toBeGreaterThanOrEqual(9)
      for (const box of controls) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      }

      // The ring, the figures, each choice and the text around them keep their own space.
      const parts = await boxes(
        section.locator(
          '.ring, .ai-usage-figures, .ai-limit, .setting-label, label.model-choice, legend, li, h3, .alert-row > span',
        ),
      )
      for (const [i, a] of parts.entries()) {
        for (const b of parts.slice(i + 1)) expect(overlapping(a, b)).toBe(false)
      }

      if (SCREENSHOTS && viewport.width === 390) {
        // As tall as the page, so the fixed tab bar sits at the bottom rather than over it.
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width: 390, height })
        await page.screenshot({ path: `${SCREENSHOTS}/settings-ai-iphone-390.png` })
      }
    })
  })
}
