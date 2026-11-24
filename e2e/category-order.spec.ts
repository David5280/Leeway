// Category pickers read A to Z: the Transactions category filter lists "All
// categories" and "Needs a category" first, then every category A to Z, even
// though the starter budget keeps them in its own custom order.

import { expect, test } from '@playwright/test'

/** A to Z the way a person reads it: case and accents ignored, numbers by value. */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const alphabetical = (names: string[]) => [...names].sort(collator.compare)

test('the Transactions category filter lists categories A to Z', async ({ page }) => {
  await page.goto('/spending/activity')
  await page.getByRole('button', { name: 'Category: all' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filter by category' })
  const options = sheet.getByRole('list', { name: 'Categories' }).getByRole('button')
  await expect(options.first()).toBeVisible()

  // Read the labels, not the whole button: a category with no glyph shows its
  // initial in the icon, which innerText would put in front of its name.
  const names = await options.locator('.option-label').allTextContents()
  expect(names.slice(0, 2)).toEqual(['All categories', 'Needs a category'])
  // Setup's starter categories, more than a few of them.
  const categories = names.slice(2)
  expect(categories.length).toBeGreaterThan(5)
  expect(categories).toEqual(alphabetical(categories))
})
