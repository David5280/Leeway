// Retirement on the Plan tab: a pension added with only the figures the owner
// gives, counted as retirement income beside savings, and a projection shown
// as a range once the owner gives a birth year. Nothing here asks the AI.

import { expect, test } from '@playwright/test'
import { PENSION, setUpRetirement, tearDownRetirement } from './retirement'

test.afterEach(async ({ page }) => tearDownRetirement(page))

test('a pension counts toward retirement, and the projection is a range', async ({ page }) => {
  await page.goto('/plan/retirement')
  const projection = page.getByRole('region', { name: 'Retirement projection' })
  await expect(projection).toContainText('Add your birth year')

  await setUpRetirement(page)

  // The benefit comes from the owner's own salary, multiplier and service.
  const pension = page.getByRole('group', { name: PENSION })
  await expect(pension).toContainText('$1,200 for your service so far')
  await expect(pension).toContainText('$275 a paycheck (11% of pay)')
  await expect(pension).toContainText('not counted again as savings')

  // With a birth year the answer is a share of the income wanted, from a range.
  await expect(projection).toContainText('Can I retire at 65?')
  await expect(projection).toContainText(/should cover \d+% to \d+% of the \$4,000 a month/)
  await expect(projection.getByRole('img', { name: 'Savings by age' })).toBeVisible()
  const income = projection.getByRole('group', { name: 'Monthly income at 65' })
  await expect(income).toContainText('Pension, entered by you')
  await expect(income).toContainText(/\$[\d,]+ to \$[\d,]+/)
  await expect(projection).toContainText('not a promise')

  // Changing a figure changes the benefit, and the form keeps what was there.
  await pension.getByRole('button', { name: 'Edit figures' }).click()
  const form = page.getByRole('form', { name: 'Pension figures' })
  await expect(form.getByRole('textbox', { name: 'Multiplier, percent per year' })).toHaveValue(
    '2.5',
  )
  await form.getByRole('textbox', { name: 'Monthly benefit from your statement' }).fill('2100')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(pension).toContainText('$2,100 / mo')
  await expect(pension).toContainText("From your plan's statement")
})
