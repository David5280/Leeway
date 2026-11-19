// The Retirement section on a phone, filled in: the projection, its chart, a
// pension and the forms all stay inside the screen's width, from an iPhone at
// 390px down to the narrowest phone in use.

import { expect, test } from '@playwright/test'
import { NARROWEST, overflow } from './phone'
import { PENSION, setUpRetirement, tearDownRetirement } from './retirement'

/** An iPhone 12 to 15, upright: 390px across. */
const IPHONE_390 = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }

for (const [name, phone] of [
  ['an iPhone 390px across', IPHONE_390],
  ['the narrowest phone', NARROWEST],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(phone)
    test.afterEach(async ({ page }) => tearDownRetirement(page))

    test('retirement with a pension fits the width', async ({ page }) => {
      await setUpRetirement(page)
      const chart = page.getByRole('img', { name: 'Savings by age' })
      await expect(chart).toBeVisible()
      const box = (await chart.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(phone.viewport.width - 16)
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      // The pension's form, every figure in it, fits too.
      await page
        .getByRole('group', { name: PENSION })
        .getByRole('button', { name: 'Edit figures' })
        .click()
      await expect(page.getByRole('form', { name: 'Pension figures' })).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
}
