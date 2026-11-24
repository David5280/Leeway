// The emergency fund on a phone: the offer, the fund's card and its accounts
// form stay inside the screen's width, upright, on the narrowest phone and
// sideways.

import { expect, test } from '@playwright/test'
import { emergencyCard, setUpEmergency, tearDownEmergency } from './emergency'
import { IPHONE, IPHONE_LANDSCAPE, NARROWEST, overflow } from './phone'

for (const [name, phone] of [
  ['an iPhone', IPHONE],
  ['the narrowest phone', NARROWEST],
  ['an iPhone turned sideways', IPHONE_LANDSCAPE],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(phone)
    test.beforeEach(async ({ page }) => setUpEmergency(page))
    test.afterEach(async ({ page }) => tearDownEmergency(page))

    test('the emergency fund offer, card and form fit the width', async ({ page }) => {
      await page.goto('/goals')
      const offer = page.getByRole('region', { name: 'Start an emergency fund' })
      await expect(offer).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      await offer.getByRole('button', { name: 'Start my emergency fund' }).click()
      const fund = emergencyCard(page)
      await expect(fund).toContainText('1 month of essentials')
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      await fund.getByRole('button', { name: 'Change accounts' }).click()
      await expect(
        fund.getByRole('form', { name: 'Accounts for the emergency fund' }),
      ).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
}
