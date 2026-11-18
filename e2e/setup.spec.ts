// First run: the owner creates their account and walks through setup. The
// signed-in session is saved for every other browser test.

import { expect, test } from '@playwright/test'
import { OWNER, OWNER_STATE, SETUP_CODE } from './owner'

test('a new owner sets up Leeway and lands on the overview', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  // A stranger who finds the address first cannot claim it without the code from the log.
  await page.getByRole('textbox', { name: 'Setup code' }).fill('WRNG-CODE-HERE')
  await page.getByRole('textbox', { name: 'Name' }).fill(OWNER.name)
  await page.getByRole('textbox', { name: 'Email' }).fill(OWNER.email)
  await page.getByRole('textbox', { name: /Password/ }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'That setup code is not right. Copy it from the server log again.',
  )
  await page.getByRole('textbox', { name: 'Setup code' }).fill(SETUP_CODE)
  await page.getByRole('button', { name: 'Continue' }).click()

  // Budget period: paid every other week, warned at 90%.
  await expect(page.getByRole('heading', { name: 'How do you budget?' })).toBeVisible()
  await page.getByRole('button', { name: 'Every paycheck' }).click()
  await page.getByRole('spinbutton', { name: 'Warn me at percent' }).fill('90')
  await page.getByRole('button', { name: 'Continue' }).click()

  // No Plaid keys on this server, so setup explains how to add them and moves on.
  await expect(page.getByText('Bank sync is not set up on this server yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // The starter categories, with one budget changed and one left out.
  await expect(page.getByRole('heading', { name: 'Pick a starting point' })).toBeVisible()
  // They are listed under group headings, so the longer list stays easy to scan.
  await expect(page.getByText('Food and drink', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Groceries budget' }).fill('650')
  await page.getByRole('checkbox', { name: 'Include Fees' }).uncheck()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "You're set" })).toBeVisible()
  await expect(page.getByText(`${new URL(page.url()).origin}/mcp`)).toBeVisible()
  await page.getByRole('button', { name: 'Open my overview' }).click()

  await expect(page.getByRole('navigation').first()).toBeVisible()
  await page.context().storageState({ path: OWNER_STATE })
})
