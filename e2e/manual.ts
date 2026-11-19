// Helpers for adding things by hand, the way an owner without bank sync would.

import { expect, type Locator, type Page } from '@playwright/test'

/** Adds an account in Settings, under Accounts, and waits until it is listed. */
export async function addAccount(
  page: Page,
  account: { name: string; type?: string; balance: string },
): Promise<void> {
  await page.goto('/settings/accounts')
  await page.getByRole('button', { name: 'Add an account by hand' }).click()
  const form = page.getByRole('form', { name: 'New account' })
  await form.getByRole('textbox', { name: 'Account name' }).fill(account.name)
  if (account.type) {
    await form.getByRole('combobox', { name: 'Account type' }).selectOption(account.type)
  }
  await form.getByRole('textbox', { name: 'Balance' }).fill(account.balance)
  await form.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('textbox', { name: `Name for ${account.name}` })).toBeVisible()
}

/** Deletes an account, and its transactions with it, so other tests see the install as before. */
export async function removeAccount(page: Page, name: string): Promise<void> {
  await page.goto('/settings/accounts')
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0)
}

/** Opens the form for adding a transaction by hand, from the Transactions screen's + menu. */
export async function openAddForm(page: Page): Promise<Locator> {
  await page.goto('/transactions')
  await page.getByRole('button', { name: 'Add or import' }).click()
  await page.getByRole('menuitem', { name: 'Add by hand' }).click()
  return page.getByRole('form', { name: 'Add a transaction' })
}

/** Adds spending by hand, dated today, and waits for its sheet to close. */
export async function addSpending(
  page: Page,
  spending: { account: string; description: string; amount: string; category?: string },
): Promise<void> {
  const form = await openAddForm(page)
  await form.getByRole('textbox', { name: 'Description' }).fill(spending.description)
  await form.getByRole('textbox', { name: 'Amount' }).fill(spending.amount)
  await form.getByRole('combobox', { name: 'Account' }).selectOption(spending.account)
  if (spending.category) {
    await form.getByRole('combobox', { name: 'Category' }).selectOption(spending.category)
  }
  await form.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toHaveCount(0)
}
