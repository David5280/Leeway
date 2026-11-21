// The emergency fund: offered in one tap at a month of essentials, then grown
// a step at a time, counting the savings accounts the owner marks.

import { expect, test } from '@playwright/test'
import { emergencyCard, RAINY_DAY, setUpEmergency, tearDownEmergency } from './emergency'

test.beforeEach(async ({ page }) => setUpEmergency(page))
test.afterEach(async ({ page }) => tearDownEmergency(page))

test('an emergency fund starts in one tap and grows a step at a time', async ({ page }) => {
  await page.goto('/plan/goals')
  const offer = page.getByRole('region', { name: 'Start an emergency fund' })
  await expect(offer).toContainText('Start with one month of essentials')
  await expect(offer).toContainText(/Then aim for 3 months: \$[\d,]+\./)
  await offer.getByRole('button', { name: 'Start my emergency fund' }).click()
  await expect(offer).toBeHidden()

  const fund = emergencyCard(page)
  await expect(fund).toContainText('1 month of essentials')
  await expect(fund).toContainText('Counts every savings account.')

  // The next step is one tap too.
  await fund.getByRole('button', { name: /^Aim for 3 months/ }).click()
  await expect(fund).toContainText('3 months of essentials')
  await expect(fund.getByRole('button', { name: /^Aim for 6 months/ })).toBeVisible()

  // Marking the account that holds it.
  await fund.getByRole('button', { name: 'Change' }).click()
  const form = fund.getByRole('form', { name: 'Accounts for the emergency fund' })
  await form.getByRole('checkbox', { name: new RegExp(RAINY_DAY) }).check()
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(fund).toContainText(`Counts ${RAINY_DAY}.`)
  await expect(fund).toContainText('$500')
})
