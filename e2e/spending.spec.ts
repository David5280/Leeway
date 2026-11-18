// Spending recorded by hand flows through to the list, its category and the overview.

import { expect, test } from '@playwright/test'
import { addAccount } from './manual'

test('cash spending added by hand shows everywhere it counts', async ({ page }) => {
  await addAccount(page, { name: 'Wallet', balance: '200' })

  await page.goto('/transactions')
  await page.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('form', { name: 'Add a transaction' })
  await form.getByRole('textbox', { name: 'Description' }).fill('Corner market')
  await form.getByRole('textbox', { name: 'Amount' }).fill('42.50')
  await form.getByRole('combobox', { name: 'Account' }).selectOption('Wallet')
  await form.getByRole('combobox', { name: 'Category' }).selectOption('Groceries')
  await form.getByRole('button', { name: 'Add' }).click()

  const list = page.getByRole('region', { name: 'Transaction list' })
  await expect(list.getByText('Corner market')).toBeVisible()
  await expect(list).toContainText('$42.50')

  // Search narrows the list, and clearing it brings the transaction back.
  const search = page.getByRole('searchbox', { name: 'Search transactions' })
  await search.fill('nothing like this')
  await expect(list.getByText('Nothing matches.')).toBeVisible()
  await search.fill('corner')
  await expect(list.getByText('Corner market')).toBeVisible()

  await page.goto('/budgets')
  await page.getByRole('link', { name: /^Groceries/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'In this category' })).toContainText(
    'Corner market',
  )

  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Recent transactions' })).toContainText(
    'Corner market',
  )
  await expect(page.getByRole('region', { name: 'This period at a glance' })).toContainText('$43')
})
