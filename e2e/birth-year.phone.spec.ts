// The birth year on a phone: asked once under the retirement projection, only
// as a year, then gone; changed later in Settings, under Planning. Upright,
// on the narrowest phone and sideways, nothing scrolls sideways.

import { expect, test, type Page } from '@playwright/test'
import { action } from './manual'
import { IPHONE, IPHONE_LANDSCAPE, NARROWEST, overflow } from './phone'
import { giveBirthYear } from './retirement'

/** Puts the birth year back to not given, since later specs share the install. */
const forget = (page: Page) => action(page, 'update_settings', { retirement: { birthYear: null } })

for (const [name, phone] of [
  ['an iPhone', IPHONE],
  ['the narrowest phone', NARROWEST],
  ['an iPhone turned sideways', IPHONE_LANDSCAPE],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(phone)
    test.afterEach(async ({ page }) => forget(page))

    test('the birth year is asked once, fits, and changes in Settings', async ({ page }) => {
      await page.goto('/plan/retirement')
      const ask = page.getByRole('region', { name: 'What year were you born?' })
      await expect(ask).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)

      // Only a four-digit year is taken; the box holds no more than four characters.
      await ask.getByRole('textbox', { name: 'Year you were born' }).fill('86')
      await ask.getByRole('button', { name: 'Save' }).click()
      await expect(ask.getByRole('alert')).toHaveText('Enter the year as four digits, like 1986.')

      await giveBirthYear(page, '1986')
      const projection = page.getByRole('region', { name: 'Retirement projection' })
      await expect(projection).not.toContainText('Add your birth year')

      await page.goto('/settings/planning')
      const field = page.getByRole('textbox', { name: 'Year you were born' })
      await expect(field).toHaveValue('1986')
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await field.fill('1984')
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
    })
  })
}
