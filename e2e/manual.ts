// Helpers for adding things by hand, the way an owner without bank sync would.

import { expect, type Page } from '@playwright/test'

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
