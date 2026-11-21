// The Plan tab: bills, savings goals, debts and net worth.

import { expect, test } from '@playwright/test'
import { addAccount } from './manual'

test('a bill added by hand is listed with the others', async ({ page }) => {
  await page.goto('/plan/bills')
  await page.getByRole('button', { name: 'Add a bill' }).click()
  const form = page.getByRole('form', { name: 'New bill' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Rent')
  await form.getByRole('textbox', { name: 'Amount' }).fill('1200')
  await form.getByRole('button', { name: 'Add bill' }).click()
  await expect(page.getByRole('region', { name: 'Bills and subscriptions' })).toContainText('Rent')
})

test('a savings goal shows what is saved so far', async ({ page }) => {
  await page.goto('/plan/goals')
  await page.getByRole('button', { name: 'Add a goal' }).click()
  const form = page.getByRole('form', { name: 'New goal' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Emergency fund')
  await form.getByRole('textbox', { name: 'Target amount' }).fill('3000')
  await form.getByRole('textbox', { name: 'Saved so far' }).fill('500')
  await form.getByRole('button', { name: 'Add goal' }).click()
  await expect(page.getByText('Emergency fund')).toBeVisible()
  await expect(page.getByText(/\$500/).first()).toBeVisible()
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
