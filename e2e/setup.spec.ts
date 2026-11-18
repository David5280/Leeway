// First run: the owner creates their account and walks through setup. The
// signed-in session is saved for every other browser test.

import { expect, test } from '@playwright/test'
import { OWNER, OWNER_STATE } from './owner'

test('a new owner sets up Leeway and lands on the overview', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Name' }).fill(OWNER.name)
  await page.getByRole('textbox', { name: 'Email' }).fill(OWNER.email)
  await page.getByRole('textbox', { name: /Password/ }).fill(OWNER.password)
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
  await page.getByRole('textbox', { name: 'Groceries budget' }).fill('650')
  await page.getByRole('checkbox', { name: 'Include Fees' }).uncheck()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "You're set" })).toBeVisible()
  await expect(page.getByText('http://localhost:3100/mcp')).toBeVisible()
  await page.getByRole('button', { name: 'Open my overview' }).click()

  await expect(page.getByRole('navigation').first()).toBeVisible()
  await page.context().storageState({ path: OWNER_STATE })
})
