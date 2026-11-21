// The payday playbook: a paycheck that landed yesterday gets a notice on the
// dashboard, which opens Payday with what was left of the everyday budget
// and a plan for the new paycheck. Every name and amount is made up.

import { expect, test } from '@playwright/test'
import { action, removeAccount } from './manual'

const CHECKING = 'payday- pb checking'

/** A date this many days before today, as the server takes it. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

let categoryId = ''

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  const account = await action<{ id: string }>(page, 'create_account', {
    name: CHECKING,
    type: 'depository',
    subtype: 'checking',
    balanceCents: 400_000,
  })
  // Four paychecks two weeks apart, the newest yesterday.
  for (const weeks of [6, 4, 2, 0]) {
    await action(page, 'create_transaction', {
      accountId: account.id,
      date: daysAgo(1 + weeks * 7),
      name: 'PAYDAY PB CO PAYROLL',
      amountCents: -210_000,
    })
  }
  const groceries = await action<{ id: string }>(page, 'create_category', {
    name: 'payday- groceries',
    budgetCents: 40_000,
  })
  categoryId = groceries.id
  const shop = await action<{ id: string }>(page, 'create_transaction', {
    accountId: account.id,
    date: daysAgo(8),
    name: 'PAYDAY PB GROCER',
    amountCents: 6_000,
  })
  await action(page, 'categorize_transactions', { ids: [shop.id], categoryId })
})

test.afterEach(async ({ page }) => {
  await action(page, 'delete_category', { id: categoryId })
  await removeAccount(page, CHECKING)
})

test('a new paycheck is greeted on the dashboard and planned on Payday', async ({ page }) => {
  await page.goto('/')
  const notice = page.getByRole('region', { name: 'Payday' })
  await expect(notice).toContainText('It is payday')
  await expect(notice).toContainText('Your paycheck of $2,100 landed.')
  await notice.getByRole('link').click()
  await expect(page).toHaveURL(/\/plan\/payday$/)

  const last = page.getByRole('region', { name: 'Your last paycheck' })
  await expect(last).toContainText('budgeted for everyday spending')
  const plan = page.getByRole('region', { name: 'Paycheck plan' })
  await expect(plan).toContainText('Payday! Here is a plan')
  await expect(plan).toContainText('Your paycheck of $2,100 landed')
  await expect(plan).toContainText('Everyday spending')
  await expect(plan).toContainText('Suggestions only. You move the money yourself.')

  await plan.getByRole('button').click()
  const sheet = page.getByRole('dialog', { name: 'Paycheck plan' })
  await expect(sheet).toContainText('Where it goes')
  await expect(sheet).toContainText('payday- groceries')
})
