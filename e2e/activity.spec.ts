// The Transactions list: opening a transaction in its sheet, changing its
// category, making a rule from it, and narrowing the list with its chips.

import { expect, test, type Page } from '@playwright/test'
import { addAccount, addSpending, removeAccount } from './manual'

/** The list of transactions, under its day headers. */
const list = (page: Page) => page.getByRole('region', { name: 'Transaction list' })

/** The rows showing, by the names they are listed under, A to Z. */
const rowNames = async (page: Page) =>
  (await list(page).locator('.act-row-name').allTextContents()).sort()

test('a transaction opens in a sheet, takes a new category, and makes a rule', async ({ page }) => {
  await addAccount(page, { name: 'Sheet checking', balance: '100' })
  await addSpending(page, {
    account: 'Sheet checking',
    description: 'SQ *BLUE BOTTLE 0412',
    amount: '5.75',
  })
  await addSpending(page, {
    account: 'Sheet checking',
    description: 'SQ *BLUE BOTTLE 0977',
    amount: '6.25',
  })

  // The bank's text reads as the merchant's name, and the row says it all.
  const row = list(page).getByRole('button', { name: /^Blue Bottle, spent \$5\.75/ })
  await expect(row).toHaveAccessibleName(
    'Blue Bottle, spent $5.75, Sheet checking, needs a category',
  )
  await row.click()
  const sheet = page.getByRole('dialog', { name: 'Blue Bottle' })
  await expect(sheet.getByText('$5.75')).toBeVisible()

  // Categories are listed A to Z; picking one files it and goes back to the details.
  await sheet.getByRole('button', { name: /^Needs a category/ }).click()
  const picker = sheet.getByRole('list', { name: 'Category for Blue Bottle' })
  const names = await picker.locator('.option-label').allTextContents()
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  await picker.getByRole('button', { name: 'Coffee' }).click()
  await expect(sheet.getByRole('button', { name: /^Coffee/ })).toContainText('Set by you')

  // A rule from the sheet starts from the merchant's name and files the rest.
  await sheet.getByRole('button', { name: 'Always categorize Blue Bottle as…' }).click()
  const rule = sheet.getByRole('form', { name: 'New rule' })
  await expect(rule.getByRole('textbox', { name: 'Text to match' })).toHaveValue('Blue Bottle')
  await rule.getByRole('combobox', { name: 'Category for matches' }).selectOption('Coffee')
  await rule.getByRole('button', { name: 'Save rule and apply' }).click()
  // Saved, the sheet goes back to the details; Escape closes it, and focus
  // goes back to the row it was opened from.
  await expect(rule).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /^Coffee/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row).toBeFocused()
  await expect(row).toHaveAccessibleName(/, Coffee$/)

  const other = list(page).getByRole('button', { name: /^Blue Bottle, spent \$6\.25/ })
  await expect(other).toHaveAccessibleName(/, Coffee$/)
  await other.click()
  await expect(page.getByRole('dialog', { name: 'Blue Bottle' })).toContainText('Set by a rule')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Leave the install as it was for the other tests.
  const rules = page.getByRole('region', { name: 'Rules' })
  await rules
    .locator('.list-row', { hasText: '"Blue Bottle"' })
    .getByRole('button', { name: /^Delete rule/ })
    .click()
  await expect(rules).not.toContainText('"Blue Bottle"')
  await removeAccount(page, 'Sheet checking')
})

test('the chips narrow the list by date, category, account and search', async ({ page }) => {
  await addAccount(page, { name: 'Chips checking', balance: '100' })
  await addAccount(page, { name: 'Chips savings', balance: '100' })
  await addSpending(page, {
    account: 'Chips checking',
    description: 'Chips grocer',
    amount: '30',
    category: 'Groceries',
  })
  await addSpending(page, { account: 'Chips savings', description: 'Chips mystery', amount: '12' })
  const search = page.getByRole('searchbox', { name: 'Search transactions' })
  await search.fill('chips')
  await expect.poll(() => rowNames(page)).toEqual(['Chips grocer', 'Chips mystery'])

  // Dates: every date keeps both; this period is the default.
  await page.getByRole('button', { name: 'Dates: This period' }).click()
  await page.getByRole('menuitemradio', { name: 'All' }).click()
  await expect(page.getByRole('button', { name: 'Dates: All' })).toBeVisible()
  await expect.poll(() => rowNames(page)).toEqual(['Chips grocer', 'Chips mystery'])

  // Category: picked from an A to Z sheet, and kept in the address.
  await page.getByRole('button', { name: 'Category: all' }).click()
  await page
    .getByRole('dialog', { name: 'Filter by category' })
    .getByRole('button', { name: 'Groceries' })
    .click()
  await expect(page).toHaveURL(/category=/)
  await expect.poll(() => rowNames(page)).toEqual(['Chips grocer'])

  // Account: groceries in savings match nothing, and one tap clears every filter.
  await page.getByRole('button', { name: 'Account: all' }).click()
  await page.getByRole('menuitemradio', { name: 'Chips savings' }).click()
  await expect(page).toHaveURL(/account=/)
  await expect(list(page).getByText('Nothing matches these filters.')).toBeVisible()
  await list(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).not.toHaveURL(/category=|account=/)
  await expect(page.getByRole('button', { name: 'Account: all' })).toBeVisible()

  // What still needs a category has a chip of its own.
  await search.fill('chips')
  const unsorted = page.getByRole('button', { name: /need a category$/ })
  await unsorted.click()
  await expect(unsorted).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rowNames(page)).toEqual(['Chips mystery'])
  await unsorted.click()

  // Search alone narrows to what it names.
  await search.fill('grocer')
  await expect.poll(() => rowNames(page)).toEqual(['Chips grocer'])

  await removeAccount(page, 'Chips savings')
  await removeAccount(page, 'Chips checking')
})
