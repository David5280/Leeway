// The Plan tab: bills, savings goals, debts and net worth.

import { expect, test } from '@playwright/test'
import { action, addAccount } from './manual'

test('a bill added by hand is listed with the others', async ({ page }) => {
  await page.goto('/plan/bills')
  await page.getByRole('button', { name: 'Add a bill' }).click()
  const form = page.getByRole('form', { name: 'New bill' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Rent')
  await form.getByRole('textbox', { name: 'Amount' }).fill('1200')
  await form.getByRole('button', { name: 'Add bill' }).click()
  await expect(page.getByRole('region', { name: 'Bills and subscriptions' })).toContainText('Rent')
})

test.describe('a goal named as an emergency fund', () => {
  // The whole name is an emergency fund's, so the goal is taken as the fund:
  // it goes again after, for the emergency fund specs that start one from
  // its offer on the same install.
  test.afterEach(async ({ page }) => {
    const goals = await action<{ id: string; name: string }[]>(page, 'list_goals')
    for (const goal of goals.filter((one) => one.name === 'Emergency fund')) {
      await action(page, 'delete_goal', { id: goal.id })
    }
  })

  test('a savings goal shows what is saved so far', async ({ page }) => {
    await page.goto('/plan/goals')
    await page.getByRole('button', { name: 'Add a goal' }).click()
    const form = page.getByRole('form', { name: 'New goal' })
    await form.getByRole('textbox', { name: 'Name' }).fill('Emergency fund')
    await form.getByRole('textbox', { name: 'Target amount' }).fill('3000')
    await form.getByRole('textbox', { name: 'Saved so far' }).fill('500')
    await form.getByRole('button', { name: 'Add goal' }).click()
    // The goal's own card, named exactly by it, never the offer beside it.
    const card = page.getByRole('region', { name: 'Emergency fund', exact: true })
    await expect(card.getByRole('heading', { name: 'Emergency fund' })).toBeVisible()
    await expect(card).toContainText('$500')
    // Taken as the fund, it is counted by hand, so no fund is offered beside it.
    await expect(card).toContainText('Counts what you add by hand.')
    await expect(page.getByRole('region', { name: 'Start an emergency fund' })).toBeHidden()
  })
})

test('a credit card balance shows under debts and in net worth', async ({ page }) => {
  await addAccount(page, { name: 'Travel card', type: 'Credit card', balance: '800' })

  await page.goto('/plan/debts')
  await expect(page.getByText('Travel card').first()).toBeVisible()

  await page.getByRole('button', { name: 'Net worth' }).click()
  await expect(page).toHaveURL(/\/plan\/net-worth$/)
  await expect(page.getByRole('region', { name: 'Net worth', exact: true })).toContainText(
    '$800 owed',
  )
})
