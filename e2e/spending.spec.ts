// Spending recorded by hand flows through to the list and its category.

import { expect, test } from '@playwright/test'
import { addAccount, addSpending, removeAccount } from './manual'

test('cash spending added by hand shows everywhere it counts', async ({ page }) => {
  await addAccount(page, { name: 'Wallet', balance: '200' })
  try {
    await addSpending(page, {
      account: 'Wallet',
      description: 'Corner market',
      amount: '42.50',
      category: 'Groceries',
    })

    const list = page.getByRole('region', { name: 'Transaction list' })
    await expect(list.getByRole('button', { name: /^Corner market, spent \$42\.50/ })).toBeVisible()

    // Search narrows the list, and clearing it brings the transaction back.
    const search = page.getByRole('searchbox', { name: 'Search transactions' })
    await search.fill('nothing like this')
    await expect(list.getByText('Nothing matches these filters.')).toBeVisible()
    await search.fill('corner')
    await expect(list.getByText('Corner market')).toBeVisible()

    await page.goto('/spending')
    await page.getByRole('link', { name: /^Groceries/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'In this category' })).toContainText(
      'Corner market',
    )
  } finally {
    // The wallet goes, and its spending with it, so no later test finds it.
    await removeAccount(page, 'Wallet')
  }
})
