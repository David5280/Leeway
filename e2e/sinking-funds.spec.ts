// Sinking funds on Payday: a yearly bill offered as one in one tap, and a
// cost added by hand, each then saved toward a little each budget period.
// Every name and amount is made up.

import { expect, test } from '@playwright/test'
import { action } from './manual'

/** A date this many days from today, as the server takes it. */
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

let billId = ''

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  const bill = await action<{ id: string }>(page, 'create_bill', {
    name: 'payday- registration',
    amountCents: 12_000,
    cadence: 'year',
    anchorDate: daysFromNow(90),
  })
  billId = bill.id
})

test.afterEach(async ({ page }) => {
  const { funds } = await action<{ funds: { id: string }[] }>(page, 'list_sinking_funds')
  for (const fund of funds) await action(page, 'delete_sinking_fund', { id: fund.id })
  await action(page, 'delete_bill', { id: billId })
})

test('a yearly bill is saved toward in one tap, and another cost is added by hand', async ({
  page,
}) => {
  await page.goto('/plan/payday')
  const found = page.getByRole('region', { name: 'Worth saving for' })
  await expect(found).toContainText('payday- registration')
  await found
    .locator('.list-row', { hasText: 'payday- registration' })
    .getByRole('button', { name: 'Add' })
    .click()
  const total = page.getByRole('region', { name: 'Yearly costs' })
  await expect(total).toContainText('Next up: payday- registration')

  await page.getByRole('button', { name: 'Add a yearly cost' }).click()
  const form = page.getByRole('form', { name: 'New yearly cost' })
  await form.getByRole('textbox', { name: 'Name' }).fill('payday- car insurance')
  await form.getByRole('textbox', { name: 'Costs' }).fill('780')
  await form.getByLabel('Next due').fill(daysFromNow(120))
  await form.getByRole('button', { name: 'Add' }).click()
  await expect(total).toContainText('For 2 costs')

  await page.getByRole('button', { name: 'Remove payday- car insurance' }).click()
  await expect(total).toContainText('For one cost')
})
