// Saving for a purchase: starting one from the Goals tab, holding its share
// back from the budget, recording money put toward it, and seeing it on the
// overview; and starting one from "Can I afford it?", which needs no AI. Also
// a budget changed in place on the Spending list.

import { expect, test, type Page } from '@playwright/test'

/** A date a year from today, as YYYY-MM-DD, so the goal always has time to run. */
function aYearFromNow(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
}

/** A spending category with a budget, so there is a leeway for goals to hold money from. */
async function addBudget(page: Page, name: string, amount: string) {
  await page.goto('/spending')
  await page.getByRole('button', { name: 'New category' }).click()
  const form = page.getByRole('form', { name: 'New category' })
  await form.getByRole('textbox', { name: 'Name' }).fill(name)
  await form.getByRole('textbox', { name: 'Budget amount' }).fill(amount)
  await form.getByRole('button', { name: 'Add category' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('a budget changes in place on the Budgets list', async ({ page }) => {
  await addBudget(page, 'Fun money', '500')
  await page.goto('/spending')
  const row = page.getByRole('group', { name: 'Fun money' })
  const shown = row.getByRole('button', { name: 'Change Fun money budget' })
  // The row shows this period's share, which differs from $500 when periods are not months.
  const before = await shown.textContent()
  await shown.click()
  const amount = row.getByRole('textbox', { name: 'Fun money budget amount' })
  await expect(amount).toHaveValue('500')
  await amount.fill('600')
  await amount.press('Enter')
  await expect(amount).toBeHidden()
  await expect(shown).not.toHaveText(before!)
  await expect(row).toContainText('left for')

  // It stays changed after a reload, and the category's page agrees.
  await page.reload()
  await page.getByRole('group', { name: 'Fun money' }).getByRole('link').click()
  await expect(
    page.getByRole('form', { name: 'Category settings' }).getByRole('textbox', {
      name: 'Budget amount',
    }),
  ).toHaveValue('600')
})

test('saving for a purchase sets money aside and counts what goes toward it', async ({ page }) => {
  await addBudget(page, 'Going out', '400')

  await page.goto('/goals')
  await page.getByRole('button', { name: 'Save for a purchase' }).click()
  const form = page.getByRole('form', { name: 'New purchase' })
  await form.getByRole('textbox', { name: 'What are you saving for?' }).fill('Road bike')
  await form.getByRole('textbox', { name: 'Price' }).fill('1200')
  await form.getByLabel('Target date').fill(aYearFromNow())
  await form.getByRole('switch', { name: 'Set aside from my budget' }).click()
  await form.getByRole('button', { name: 'Start saving' }).click()

  const card = page.getByRole('region', { name: 'Road bike' })
  await expect(card.getByText('Purchase', { exact: true })).toBeVisible()
  await expect(card.getByText(/held from this .+ budget/)).toBeVisible()
  await expect(card.getByText(/to buy it by/)).toBeVisible()
  await expect(card.getByRole('img', { name: 'Road bike timeline' })).toBeVisible()

  // "I put $50 toward it", then the history shows it.
  await card.getByRole('textbox', { name: 'Amount to add to Road bike' }).fill('50')
  await card.getByRole('button', { name: 'Add' }).click()
  await expect(card.getByText('$50', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'History' }).click()
  await expect(card.getByRole('list', { name: 'Road bike history' })).toContainText('+$50.00')

  // The overview's leeway holds the goal's share back and says so.
  await page.goto('/')
  const leeway = page.getByRole('region', { name: 'Your leeway' })
  await expect(
    leeway.getByRole('list', { name: 'Set aside for goals' }).getByRole('listitem'),
  ).toContainText(['Set aside for Road bike'])
  // Its math takes the share out of what is left to spend.
  await leeway.getByRole('button', { name: /show how it adds up/ }).click()
  await expect(
    page.getByRole('dialog').getByRole('region', { name: 'How it adds up' }),
  ).toContainText(/minus set aside for goals \$\d+/)
  await page.keyboard.press('Escape')
})

test('can I afford it answers with no AI, and a not yet starts a purchase goal', async ({
  page,
}) => {
  await page.goto('/goals')
  const form = page.getByRole('form', { name: 'Can I afford it?' })
  await form.getByRole('textbox', { name: 'What is it?' }).fill('Sailboat')
  // More than any seeded account holds, so it never fits today.
  await form.getByRole('textbox', { name: 'Price' }).fill('1000000')
  await form.getByRole('button', { name: 'Check' }).click()

  const answer = page.getByRole('status', { name: 'The answer' })
  await expect(answer).toContainText('Sailboat at $1,000,000')
  await answer.getByRole('button', { name: 'Save for it' }).click()

  const goal = page.getByRole('form', { name: 'New purchase' })
  await expect(goal.getByRole('textbox', { name: 'What are you saving for?' })).toHaveValue(
    'Sailboat',
  )
  await expect(goal.getByRole('textbox', { name: 'Price' })).toHaveValue('1000000')
})
