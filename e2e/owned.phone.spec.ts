// Things entered by hand on a phone: the card and its form stay inside the
// screen's width, upright, on the narrowest phone and sideways.

import { expect, test } from '@playwright/test'
import { addCabin, CABIN, removeCabin } from './owned'
import { IPHONE, IPHONE_LANDSCAPE, NARROWEST, overflow } from './phone'

for (const [name, phone] of [
  ['an iPhone', IPHONE],
  ['the narrowest phone', NARROWEST],
  ['an iPhone turned sideways', IPHONE_LANDSCAPE],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(phone)
    test.afterEach(async ({ page }) => removeCabin(page))

    test('what is entered by hand fits the width, and so does its form', async ({ page }) => {
      await addCabin(page)
      await page.goto('/wealth')
      const card = page.getByRole('region', { name: 'Entered by you' })
      await expect(card).toContainText('Yours after the loan: $60,000')
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      await card
        .getByRole('group', { name: 'You own' })
        .getByRole('button', { name: new RegExp(`^${CABIN}`) })
        .click()
      await expect(page.getByRole('form', { name: `Edit ${CABIN}` })).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
}
