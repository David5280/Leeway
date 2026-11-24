// Making a category and changing its budget, and the overview's list of them.

import { expect, test } from '@playwright/test'
import { showWidgets } from './dashboard'
import { action, addAccount, addSpending, removeAccount } from './manual'

test('a new category gets a budget, which can be changed on its own page', async ({ page }) => {
  await page.goto('/spending')
  await page.getByRole('button', { name: 'New category' }).click()
  const form = page.getByRole('form', { name: 'New category' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Hobbies')
  await form.getByRole('textbox', { name: 'Budget amount' }).fill('120')
  await form.getByRole('button', { name: 'Add category' }).click()

  // A new category opens on its own page.
  await expect(page.getByRole('heading', { level: 1, name: 'Hobbies' })).toBeVisible()

  const settings = page.getByRole('form', { name: 'Category settings' })
  await settings.getByRole('textbox', { name: 'Budget amount' }).fill('200')
  await settings.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('form', { name: 'Category settings' }).getByRole('textbox', {
      name: 'Budget amount',
    }),
  ).toHaveValue('200')

  await page.getByRole('link', { name: 'All categories' }).click()
  await expect(
    page
      .getByRole('region', { name: 'Spending categories' })
      .getByRole('link', { name: /^Hobbies/ }),
  ).toBeVisible()
})

test("the overview's category bars line up, however wide a row's figures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // One category on track and one far over budget, whose figures run wide.
  const calm = await action<{ id: string }>(page, 'create_category', {
    name: 'Calm',
    budgetCents: 100_000,
  })
  const over = await action<{ id: string }>(page, 'create_category', {
    name: 'Overspent',
    budgetCents: 1_000,
  })
  await addAccount(page, { name: 'Bars checking', balance: '20000' })
  await addSpending(page, {
    account: 'Bars checking',
    description: 'Big spend',
    amount: '12345.67',
    category: 'Overspent',
  })

  await showWidgets(page, ['categories'])
  await page.goto('/')
  const widget = page.getByRole('region', { name: 'Categories', exact: true })
  await expect(widget.locator('.cbar', { hasText: 'Overspent' })).toContainText(/Over\s*\$12,/)
  const edges = await widget.locator('.cbar-track').evaluateAll((bars) =>
    bars.map((bar) => {
      const box = bar.getBoundingClientRect()
      return `${Math.round(box.left)} to ${Math.round(box.right)}`
    }),
  )
  expect(edges.length).toBeGreaterThan(1)
  expect(new Set(edges)).toEqual(new Set([edges[0]]))

  await removeAccount(page, 'Bars checking')
  for (const { id } of [calm, over]) await action(page, 'delete_category', { id })
})
