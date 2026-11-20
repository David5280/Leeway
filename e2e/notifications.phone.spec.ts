// Notifications on a phone: the bell in the header opens the inbox, and the
// settings reach from there. The layout guard checks how both lay out.

import { expect, test } from '@playwright/test'
import { IPHONE } from './phone'

test.use(IPHONE)

test('the bell in the header opens the inbox, which links to its settings', async ({ page }) => {
  await page.goto('/')
  const bell = page.getByRole('banner').getByRole('link', { name: /^Inbox/ })
  const box = (await bell.boundingBox())!
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
  await bell.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings, then Notifications' }).click()
  await expect(page).toHaveURL(/\/settings\/notifications$/)
  await expect(page.getByRole('switch', { name: 'Notify me: Overdrawn' })).toBeVisible()
})
