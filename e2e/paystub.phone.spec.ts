// The paystub review on a phone: every figure, badge and source line stays
// inside the screen, nothing sits on top of anything else, and every control
// is at least 44px tall, from an iPhone at 390px down to the narrowest phone
// and turned sideways. The reader is stood in for, as on the desktop.

import { expect, test, type Locator } from '@playwright/test'
import { overflow } from './phone'
import { deletePaystubs, importPaystub, mockReader } from './paystub'
import { addPension, tearDownRetirement } from './retirement'

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
    test.afterEach(async ({ page }) => {
      await deletePaystubs(page)
      await tearDownRetirement(page)
    })

    test('the paystub review fits, with nothing overlapping and 44px targets', async ({ page }) => {
      await addPension(page)
      await mockReader(page)
      await page.goto('/plan/retirement')
      await importPaystub(page)
      const review = page.getByRole('form', { name: 'Review the paystub' })
      // Open both folds, so the figures Claude did not find are measured too.
      for (const fold of await review.locator('details summary').all()) await fold.click()

      expect(await overflow(page)).toBeLessThanOrEqual(0)

      // Each figure (label, badge, input, source line) stays clear of its neighbours.
      const figures = await boxes(review.locator('.review-figure'))
      expect(figures.length).toBeGreaterThan(10)
      for (const [i, a] of figures.entries()) {
        expect(a.x + a.width).toBeLessThanOrEqual(viewport.width)
        for (const b of figures.slice(i + 1)) expect(overlapping(a, b)).toBe(false)
      }
      // Inside a figure, its label and badge sit side by side or wrap, never on top.
      for (const figure of await review.locator('.review-figure').all()) {
        const [label, badge] = [figure.locator('label').first(), figure.locator('.badge')]
        if ((await badge.count()) === 0) continue
        expect(overlapping((await label.boundingBox())!, (await badge.boundingBox())!)).toBe(false)
      }

      // Every control is big enough for a thumb.
      const targets = review.locator(
        'input:not([type=checkbox]), select, button, summary, .check-row',
      )
      for (const box of await boxes(targets)) expect(box.height).toBeGreaterThanOrEqual(44)

      await review.getByRole('button', { name: 'Cancel' }).click()
      const card = page.getByRole('region', { name: 'Paystub' })
      for (const box of await boxes(card.getByRole('button'))) {
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    })
  })
}
