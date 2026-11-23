// Goals in order on a phone: the list, its move buttons and the amount's form
// stay inside the screen's width, upright, on the narrowest phone and sideways.

import { expect, test } from '@playwright/test'
import { CAR, setUpOrder, tearDownOrder } from './goal-order'
import { IPHONE, IPHONE_LANDSCAPE, NARROWEST, overflow } from './phone'

for (const [name, phone] of [
  ['an iPhone', IPHONE],
  ['the narrowest phone', NARROWEST],
  ['an iPhone turned sideways', IPHONE_LANDSCAPE],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(phone)
    test.beforeEach(async ({ page }) => setUpOrder(page))
    test.afterEach(async ({ page }) => tearDownOrder(page))

    test('goals in order fit the width, buttons and all', async ({ page }) => {
      await page.goto('/plan/goals')
      const card = page.getByRole('region', { name: 'Which goal comes first?' })
      await expect(card).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      const up = (await card.getByRole('button', { name: `Move ${CAR} up` }).boundingBox())!
      expect(up.x + up.width).toBeLessThanOrEqual(phone.viewport.width)

      await card.getByRole('button', { name: 'Change' }).click()
      await expect(
        card.getByRole('textbox', { name: 'How much can you put toward goals each month?' }),
      ).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
}
