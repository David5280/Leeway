// What a credit card's balance costs in interest: the gentle prompt for its
// APR on the card's page, then the cost a month there, under the cards on
// Accounts and atop Plan, Debts.

import { expect, test } from '@playwright/test'
import { action } from './seed'

test.describe('card interest', () => {
  let accountId: string | null = null

  test.afterEach(async ({ request }) => {
    if (accountId) await action(request, 'delete_account', { id: accountId })
    accountId = null
  })

  test('asks for the APR once, then says what the balance costs', async ({ page, request }) => {
    const card = await action<{ id: string }>(request, 'create_account', {
      name: 'Interest test card',
      type: 'credit',
      balanceCents: 240_000,
    })
    accountId = card.id

    await page.goto(`/accounts/${card.id}`)
    const prompt = page.getByRole('region', { name: "Add this card's APR" })
    await expect(prompt).toContainText('to see what the balance costs you')
    await prompt.getByRole('textbox', { name: 'APR' }).fill('24.99')
    await prompt.getByRole('button', { name: 'Save' }).click()

    // $2,400 at 24.99% is $49.98 a month, shown to the dollar.
    const interest = page.getByRole('region', { name: 'Interest on this card' })
    await expect(interest).toContainText('If you carry this balance, about $50 a month in interest')
    await expect(prompt).toHaveCount(0)
    await interest.getByRole('button').click()
    const drill = page.getByRole('dialog', { name: 'Interest on this card' })
    await expect(drill).toContainText('divided by A year 12 months')
    await drill.getByRole('link', { name: /Change the APR/ }).click()
    await expect(page).toHaveURL(/\/plan\/debts$/)
    await expect(page.getByRole('region', { name: 'Your debts' })).toContainText(
      /Carrying (this balance|these balances) costs about \$[\d,]+ a month in interest/,
    )

    await page.goto('/accounts')
    await expect(
      page.getByRole('link', { name: /a month in interest|cards' APRs/ }),
    ).toHaveAttribute('href', '/plan/debts')
  })
})
