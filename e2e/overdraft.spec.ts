// The overdraft forecast on Payday: checking that rent would take below zero
// before payday gets an amber card with the move that would cover it, and
// the same warning in Heads up. Every name and amount is made up.

import { expect, test } from '@playwright/test'
import { action, removeAccount } from './manual'

const CHECKING = 'payday- od checking'
const SAVINGS = 'payday- od savings'

/** A date this many days from today, as the server takes it. */
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

let billId = ''

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  for (const [name, subtype, balanceCents] of [
    [CHECKING, 'checking', 50_000],
    [SAVINGS, 'savings', 300_000],
  ] as const) {
    await action(page, 'create_account', { name, type: 'depository', subtype, balanceCents })
  }
  const bill = await action<{ id: string }>(page, 'create_bill', {
    name: 'payday- rent',
    amountCents: 80_000,
    cadence: 'month',
    anchorDate: daysFromNow(1),
  })
  billId = bill.id
})

test.afterEach(async ({ page }) => {
  await action(page, 'delete_bill', { id: billId })
  await removeAccount(page, CHECKING)
  await removeAccount(page, SAVINGS)
})

test('checking that rent would overdraw gets an amber warning with the move that covers it', async ({
  page,
}) => {
  await page.goto('/plan/payday')
  const card = page.getByRole('region', { name: `${CHECKING} before payday` })
  await expect(card).toHaveClass(/warn-card/)
  await expect(card).toContainText(`${CHECKING} may run short`)
  await expect(card).toContainText('Could go below zero by$300')
  await expect(card).toContainText(`Moving $300 from ${SAVINGS} by`)

  await card.getByRole('button').click()
  const sheet = page.getByRole('dialog', { name: CHECKING })
  await expect(sheet).toContainText('payday- rent')
})
