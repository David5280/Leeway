// Importing history from a bank's CSV export: preview, import into a new
// account, a second import that adds nothing, and undo.

import { expect, test, type Page } from '@playwright/test'

/** A small export in a common US bank shape: month-first dates, spending negative. */
const FIXTURE = 'e2e/fixtures/old-checking.csv'

/** Opens the Import screen and chooses the fixture file. */
async function chooseFixture(page: Page) {
  await page.goto('/transactions')
  await page.getByRole('link', { name: 'Import a file' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import transactions' })).toBeVisible()
  await page.getByLabel('Choose a CSV file').setInputFiles(FIXTURE)
}

test('a CSV export imports once, skips what is already there, and can be undone', async ({
  page,
}) => {
  await chooseFixture(page)

  // The preview shows the rows as they will be saved: spending plain, pay with a plus.
  await expect(page.getByRole('status')).toHaveText(
    '5 rows ready to import, 1 cannot be read and will be skipped.',
  )
  const preview = page.getByRole('table', { name: 'Rows as they will be saved' })
  await expect(preview).toContainText('Fresh Fields Market')
  await expect(preview).toContainText('$82.10')
  await expect(preview).toContainText('+$2,400.00')
  await expect(page.getByRole('list', { name: 'Rows that cannot be read' })).toContainText(
    'Row 7 has "pending", which is not a date.',
  )

  // Into a new account named after the file; the repeated market row is skipped.
  await page.getByRole('combobox', { name: 'Leeway account' }).selectOption('A new account')
  await expect(page.getByRole('textbox', { name: 'New account name' })).toHaveValue('old-checking')
  await page.getByRole('textbox', { name: 'New account name' }).fill('Old checking')
  await page.getByRole('button', { name: 'Import 5 transactions' }).click()
  const done = page.getByRole('region', { name: 'Import finished' })
  await expect(done).toContainText(
    'Added 4 transactions to Old checking. Skipped as duplicates: 1 repeated in the file.',
  )
  await expect(done).toContainText('Model trains')

  // The rows are in the list, with the category the file gave.
  await done.getByRole('link', { name: 'See transactions' }).click()
  await page.getByRole('group', { name: 'Dates' }).getByRole('button', { name: 'All' }).click()
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill('fresh fields')
  const list = page.getByRole('region', { name: 'Transaction list' })
  await expect(list.getByText('Fresh Fields Market')).toHaveCount(1)
  await expect(
    list
      .getByRole('combobox', { name: 'Category for Fresh Fields Market' })
      .locator('option:checked'),
  ).toHaveText('Groceries')
  await list.getByRole('button', { name: /Fresh Fields Market/ }).click()
  await expect(list.getByText('Imported from a file.')).toBeVisible()

  // The same file again, into the same account, adds nothing.
  await chooseFixture(page)
  await page.getByRole('combobox', { name: 'Leeway account' }).selectOption('Old checking')
  await page.getByRole('button', { name: 'Import 5 transactions' }).click()
  await expect(page.getByRole('region', { name: 'Import finished' })).toContainText(
    'Added 0 transactions to Old checking. Skipped as duplicates: 4 already in Leeway, 1 repeated in the file.',
  )

  // Undo removes the first import's rows, after asking once more.
  const past = page.getByRole('region', { name: 'Past imports' })
  await expect(past).toContainText('4 transactions into Old checking')
  await past.getByRole('button', { name: 'Undo' }).click()
  await past.getByRole('button', { name: 'Delete its 4 transactions' }).click()
  await expect(past).toHaveCount(0)

  await page.goto('/transactions')
  await page.getByRole('group', { name: 'Dates' }).getByRole('button', { name: 'All' }).click()
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill('fresh fields')
  await expect(list.getByText('Nothing matches.')).toBeVisible()
})
