// On a phone every field is at least 16px, so iOS never zooms in on focus and
// leaves the page zoomed. The setup steps are checked in setup.spec.ts.

import { expect, test } from '@playwright/test'
import { smallFields } from './fields'
import { addAccount, openAddForm, removeAccount } from './manual'
import { IPHONE } from './phone'

test.use(IPHONE)

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('the sign-in fields are big enough not to zoom', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible()
    expect(await smallFields(page)).toEqual([])
  })
})

test('the transaction fields are big enough not to zoom', async ({ page }) => {
  // Adding by hand needs an account to add to.
  await addAccount(page, { name: 'Field size checking', balance: '100' })
  await expect(await openAddForm(page)).toBeVisible()
  expect(await smallFields(page)).toEqual([])

  await removeAccount(page, 'Field size checking')
})

// Every Settings group that has fields, each at its own address.
for (const group of ['appearance', 'budgeting', 'accounts', 'email', 'data', 'sign-in']) {
  test(`the ${group} settings fields are big enough not to zoom`, async ({ page }) => {
    await page.goto(`/settings/${group}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('input, select, textarea').first()).toBeVisible()
    expect(await smallFields(page)).toEqual([])
  })
}
