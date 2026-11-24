// Everything owned and owed beyond the bank link: a loan and the home it is
// against, entered by hand on the Net worth section, changed, and removed,
// each marked as the owner's own figures.

import { expect, test } from '@playwright/test'
import { CABIN, CABIN_LOAN, removeCabin } from './owned'

test.afterEach(async ({ page }) => removeCabin(page))

test('a home and its loan are added, changed and removed by hand', async ({ page }) => {
  await page.goto('/wealth')
  const card = page.getByRole('region', { name: 'Entered by you' })

  // The loan first, with its rate and payment.
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  let form = page.getByRole('form', { name: 'Add something' })
  await form.getByRole('button', { name: 'Loan' }).click()
  await form.getByRole('textbox', { name: 'Name' }).fill(CABIN_LOAN)
  await form.getByRole('textbox', { name: 'Still owed' }).fill('90000')
  await form.getByRole('textbox', { name: 'Rate, %' }).fill('5.5')
  await form.getByRole('textbox', { name: 'Monthly payment' }).fill('600')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form).toBeHidden()
  const owed = card.getByRole('group', { name: 'You owe' })
  await expect(owed).toContainText(`${CABIN_LOAN}$90,000Loan at 5.5%`)

  // Then the home, with the loan against it.
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  form = page.getByRole('form', { name: 'Add something' })
  await form.getByRole('textbox', { name: 'Name' }).fill(CABIN)
  await form.getByRole('textbox', { name: 'Worth about' }).fill('150000')
  await form.getByRole('combobox', { name: 'Loan on it' }).selectOption(CABIN_LOAN)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form).toBeHidden()
  const owned = card.getByRole('group', { name: 'You own' })
  await expect(owned).toContainText(`Home, with ${CABIN_LOAN}`)
  await expect(owned).toContainText('Yours after the loan: $60,000')

  // A new value, and what is left after the loan follows.
  await owned.getByRole('button', { name: new RegExp(`^${CABIN}`) }).click()
  form = page.getByRole('form', { name: `Edit ${CABIN}` })
  await form.getByRole('textbox', { name: 'Worth about' }).fill('165000')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(owned).toContainText('Yours after the loan: $75,000')

  // Removed, it leaves the card and the loan is no longer tied to anything.
  await owned.getByRole('button', { name: new RegExp(`^${CABIN}`) }).click()
  await page
    .getByRole('form', { name: `Edit ${CABIN}` })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(owned.getByRole('button', { name: new RegExp(`^${CABIN}`) })).toHaveCount(0)
  await expect(owed).toContainText(CABIN_LOAN)
})
