// Tracking a recurring charge found in history as a bill in one tap: the
// toast says so and offers Undo, and the bill can be changed in Bills after.

import { expect, test } from '@playwright/test'
import { action } from './seed'

/** A date this many days before today, as the server takes it. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

test('Comcast, found in history, becomes a bill in one tap, and Undo takes it back', async ({
  page,
  request,
}) => {
  const { id: accountId } = await action<{ id: string }>(request, 'create_account', {
    name: 'Cable checking',
    type: 'depository',
    balanceCents: 120_000,
  })
  try {
    // $80 a month for three months: a monthly charge, not yet a bill.
    for (const days of [75, 45, 15]) {
      await action(request, 'create_transaction', {
        accountId,
        date: daysAgo(days),
        name: 'Comcast',
        amountCents: 8_000,
      })
    }
    await page.goto('/payday/bills')
    const found = page.getByRole('region', { name: 'Found in your history' })
    const bills = page.getByRole('region', { name: 'Bills and subscriptions' })
    const row = found.locator('.list-row', { hasText: 'Comcast' })
    await expect(row).toContainText('$80.00 monthly')

    await row.getByRole('button', { name: 'Track' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Comcast added to Bills' })
    await expect(toast).toBeVisible()
    // No form to fill in: the bill is listed at once, and the suggestion is gone.
    await expect(page.getByRole('form', { name: 'New bill' })).toHaveCount(0)
    await expect(bills.getByRole('button', { name: /Comcast/ })).toBeVisible()
    await expect(found.getByText('Comcast')).toHaveCount(0)

    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(toast).toHaveCount(0)
    await expect(bills.getByRole('button', { name: /Comcast/ })).toHaveCount(0)
    await expect(found.locator('.list-row', { hasText: 'Comcast' })).toBeVisible()

    // Tracked again, it opens in Bills like any other, with what was found filled in.
    await found
      .locator('.list-row', { hasText: 'Comcast' })
      .getByRole('button', { name: 'Track' })
      .click()
    await bills.getByRole('button', { name: /Comcast/ }).click()
    const form = page.getByRole('form', { name: 'Edit Comcast' })
    await expect(form.getByRole('textbox', { name: 'Amount' })).toHaveValue('80')
    await form.getByRole('button', { name: 'Delete' }).click()
    await expect(bills.getByRole('button', { name: /Comcast/ })).toHaveCount(0)
  } finally {
    // Deleting the account deletes its transactions.
    await action(request, 'delete_account', { id: accountId })
  }
})
