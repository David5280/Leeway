// The Plan's Payday section: the pay Leeway finds in the paychecks, confirmed
// in one tap, and the owner's own pay in its place. Every name and amount is
// made up.

import { expect, test, type Page } from '@playwright/test'
import { action, addAccount, removeAccount } from './manual'

const ACCOUNT = 'payday- checking'

/** A date this many days before today, as the server takes it. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

/** Four paychecks two weeks apart, the last three days ago. */
async function addPaychecks(page: Page): Promise<void> {
  await addAccount(page, { name: ACCOUNT, balance: '3000' })
  const accounts = await action<{ id: string; name: string }[]>(page, 'list_accounts')
  const accountId = accounts.find((account) => account.name === ACCOUNT)!.id
  for (const weeks of [6, 4, 2, 0]) {
    await action(page, 'create_transaction', {
      accountId,
      date: daysAgo(3 + weeks * 7),
      name: 'PAYDAY TEST CO PAYROLL',
      amountCents: -210_000,
    })
  }
}

test.afterEach(async ({ page }) => {
  // Back to the paychecks as found: the owner's own pay and any confirmation cleared.
  await action(page, 'set_pay', { pay: null })
  await removeAccount(page, ACCOUNT)
})

test('pay found in the paychecks is confirmed in one tap, then replaced by the owner’s own', async ({
  page,
}) => {
  await addPaychecks(page)
  await page.goto('/plan')
  const pay = page.getByRole('region', { name: 'Your pay' })
  await expect(pay).toContainText('Each paycheck$2,100')
  await expect(pay).toContainText('Every 2 weeks from')

  // Whether four paydays also fit twice a month depends on today; once confirmed, it is settled.
  await page.getByRole('button', { name: 'Looks right' }).click()
  await expect(pay.getByText('Estimate')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Looks right' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Change my pay' }).click()
  const form = page.getByRole('form', { name: 'Enter your pay' })
  await form.getByRole('textbox', { name: 'One paycheck' }).fill('2500')
  await form.getByRole('combobox', { name: 'How often you are paid' }).selectOption('Twice a month')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(pay).toContainText('Each paycheck$2,500')
  await expect(pay).toContainText('Twice a month, as you entered it.')

  await page.getByRole('button', { name: 'Use my paychecks' }).click()
  await expect(pay).toContainText('Each paycheck$2,100')
})
