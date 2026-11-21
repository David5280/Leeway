// Helpers for the Retirement section: a Colorado PERA pension with the figures
// an owner reads off a statement and a paystub, the assumptions behind a
// projection, and putting the install back as it was for the specs after.

import { expect, type Page } from '@playwright/test'
import { action, addAccount } from './manual'

export const PENSION = 'Colorado PERA'
export const SAVINGS = 'Brokerage'

/** Adds the pension from the Retirement section and waits until it is listed. */
export async function addPension(page: Page): Promise<void> {
  await page.goto('/plan/retirement')
  await page.getByRole('button', { name: 'Add a pension' }).click()
  const form = page.getByRole('form', { name: 'New pension' })
  await form.getByRole('textbox', { name: 'Name' }).fill(PENSION)
  await form.getByRole('textbox', { name: 'Member balance' }).fill('65000')
  await form.getByRole('combobox', { name: 'Contribution type' }).selectOption('percent')
  await form.getByRole('textbox', { name: 'Percent of pay', exact: true }).fill('11')
  await form.getByRole('textbox', { name: 'Gross pay each paycheck' }).fill('2500')
  await form.getByRole('combobox', { name: 'Pay schedule' }).selectOption('biweek')
  await form.getByRole('textbox', { name: 'Employer adds, percent of pay' }).fill('21.4')
  await form.getByRole('textbox', { name: 'Years of service' }).fill('8')
  await form.getByRole('textbox', { name: 'Monthly salary the formula uses' }).fill('6000')
  await form.getByRole('textbox', { name: 'Multiplier, percent per year' }).fill('2.5')
  await form.getByRole('button', { name: 'Add pension' }).click()
  await expect(form).toBeHidden()
  await expect(page.getByRole('group', { name: PENSION })).toBeVisible()
}

/** Answers the birth year card under the projection, which leaves once answered. */
export async function giveBirthYear(page: Page, year: string): Promise<void> {
  const card = page.getByRole('region', { name: 'What year were you born?' })
  await card.getByRole('textbox', { name: 'Year you were born' }).fill(year)
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card).toBeHidden()
}

/** Sets the income wanted, or clears it when given a blank. */
export async function setAssumptions(page: Page, { income }: { income: string }): Promise<void> {
  const form = page.getByRole('form', { name: 'Retirement assumptions' })
  await form.getByRole('textbox', { name: 'Income you want a month' }).fill(income)
  await form.getByRole('button', { name: 'Save assumptions' }).click()
  await expect(form.getByRole('status')).toHaveText('Saved. The projection above uses them.')
}

/** An owner born in 1986 with $40,000 invested, a pension, and $4,000 a month wanted. */
export async function setUpRetirement(page: Page): Promise<void> {
  await addAccount(page, { name: SAVINGS, type: 'investment', balance: '40000' })
  await addPension(page)
  await giveBirthYear(page, '1986')
  await setAssumptions(page, { income: '4000' })
}

/** Removes what setUpRetirement added, since later specs share the install. */
export async function tearDownRetirement(page: Page): Promise<void> {
  // The birth year is only ever set from a screen, never cleared, so it goes back here.
  await action(page, 'update_settings', {
    retirement: { birthYear: null, targetMonthlyIncomeCents: null },
  })
  await page.goto('/settings/accounts')
  // The list must have loaded before an account's absence means anything: it
  // shows a switch for each account, or says there are none.
  const accounts = page.getByRole('region', { name: 'Accounts' })
  await expect(
    accounts
      .getByRole('switch', { name: /^Count / })
      .or(accounts.getByText(/^No accounts yet/))
      .first(),
  ).toBeVisible()
  for (const name of [PENSION, SAVINGS]) {
    const remove = page.getByRole('button', { name: `Delete ${name}` })
    // A test that stopped early may not have added both.
    if ((await remove.count()) === 0) continue
    await remove.click()
    await expect(remove).toHaveCount(0)
  }
}
