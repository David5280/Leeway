// Making a category, changing its budget, and finding it among every category.

import { expect, test } from '@playwright/test'

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
