// Category pickers read A to Z: the Transactions filter lists "All
// categories" first, then its groups A to Z, each group's categories A to Z,
// even though the starter budget keeps them in its own custom order.

import { expect, test } from '@playwright/test'

/** A to Z the way a person reads it: case and accents ignored, numbers by value. */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const alphabetical = (names: string[]) => [...names].sort(collator.compare)

test('the Transactions category filter lists categories A to Z under A to Z groups', async ({
  page,
}) => {
  await page.goto('/transactions')
  const filter = page.getByRole('combobox', { name: 'Category filter' })
  await expect(filter).toBeVisible()

  const listed = await filter.evaluate((select: HTMLSelectElement) => ({
    first: select.options[0]?.text,
    groups: [...select.querySelectorAll('optgroup')].map((group) => ({
      label: group.label,
      names: [...group.querySelectorAll('option')].map((option) => option.text),
    })),
  }))

  expect(listed.first).toBe('All categories')
  // Setup's starter categories come under group headings.
  expect(listed.groups.length).toBeGreaterThan(1)
  const headed = listed.groups.filter((group) => group.label !== 'Other')
  expect(headed.map((g) => g.label)).toEqual(alphabetical(headed.map((g) => g.label)))
  for (const group of listed.groups) {
    expect(group.names, `${group.label} is A to Z`).toEqual(alphabetical(group.names))
  }
  // Ungrouped categories, if any, come last.
  const other = listed.groups.findIndex((group) => group.label === 'Other')
  expect(other === -1 || other === listed.groups.length - 1).toBe(true)
})
