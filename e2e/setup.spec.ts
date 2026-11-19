// First run: the owner proves the install is theirs with the setup code,
// creates their sign-in and walks through setup without bank sync. The
// signed-in session is saved for every other browser test.

import { expect, test } from '@playwright/test'
import { expectPhoneSizedFields, smallFields } from './fields'
import { OWNER, OWNER_STATE, SETUP_CODE } from './owner'

test('the setup code comes first, says where to find it, and refuses a wrong one', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Enter your setup code' })).toBeVisible()
  // This server sets SETUP_CODE, so the page points there rather than to the log.
  await expect(page.getByText('Where to find it')).toBeVisible()
  await expect(page.getByText('Copy the value of SETUP_CODE.')).toBeVisible()
  // Nothing else is asked until the code is right.
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Setup code' }).fill('WRNG-CODE-HERE')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "That setup code is not right. Copy it again from SETUP_CODE in Leeway's settings.",
  )
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)

  // On a phone, the six steps fit across the top without widening the page.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('Step 1 of 6')).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  expect(await smallFields(page)).toEqual([])
})

test('a new owner sets up Leeway without bank sync and is shown how to add money', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Setup code' }).fill(SETUP_CODE.toLowerCase())
  await page.getByRole('button', { name: 'Continue' }).click()

  // The sign-in, with a short password refused in a sentence first.
  await expect(page.getByRole('heading', { name: 'Create your sign-in' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Your name (optional)' }).fill(OWNER.name)
  await page.getByRole('textbox', { name: 'Email' }).fill(OWNER.email)
  await page.getByLabel('Password').fill('too short')
  await expect(page.getByText('1 more character to go.')).toBeVisible()
  await page.getByRole('button', { name: 'Create my account' }).click()
  await expect(page.getByRole('alert')).toHaveText('Use a password of at least 10 characters.')
  await page.getByLabel('Password').fill(OWNER.password)
  await expect(page.getByText('Long enough.')).toBeVisible()
  await expectPhoneSizedFields(page)
  await page.getByRole('button', { name: 'Create my account' }).click()

  // Budget period: paid every other week, warned at 90%.
  await expect(page.getByRole('heading', { name: 'How do you budget?' })).toBeVisible()
  await expect(page.getByText('Step 3 of 6')).toBeVisible()
  await page.getByRole('button', { name: 'Every paycheck' }).click()
  await page.getByRole('spinbutton', { name: 'Warn me at percent' }).fill('90')
  await expectPhoneSizedFields(page)
  await page.getByRole('button', { name: 'Continue' }).click()

  // No Plaid keys on this server: setup says sync is optional, folds away how
  // to turn it on, and asks for no keys on the page.
  await expect(page.getByRole('heading', { name: 'Sync your bank' })).toBeVisible()
  await expect(page.getByText('Bank sync is off on this Leeway.')).toBeVisible()
  await expect(page.getByText('dashboard.plaid.com', { exact: true })).toBeHidden()
  await page.getByText('How to turn on bank sync').click()
  await expect(page.getByRole('link', { name: 'Developers, then Keys' })).toBeVisible()
  await expect(page.getByText(/free Trial plan/)).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // The starter categories, with one budget changed and one left out.
  await expect(page.getByRole('heading', { name: 'Choose your categories' })).toBeVisible()
  // They are listed under group headings, so the longer list stays easy to scan.
  await expect(page.getByText('Food and drink', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Groceries budget' }).fill('650')
  await page.getByRole('checkbox', { name: 'Include Fees' }).uncheck()
  await expectPhoneSizedFields(page)
  await page.getByRole('button', { name: 'Continue' }).click()

  // Without a bank, the last step offers the two other ways money gets in.
  await expect(page.getByRole('heading', { name: "You're set" })).toBeVisible()
  await expect(page.getByText(`${new URL(page.url()).origin}/mcp`)).toBeVisible()
  await expect(page.getByRole('button', { name: /Add an account by hand/ })).toBeVisible()
  await page.getByRole('button', { name: /Import a CSV file/ }).click()
  await expect(page.getByRole('heading', { name: 'Import transactions' })).toBeVisible()
  await expect(page).toHaveURL(/\/transactions\/import$/)

  // Setup is over: the app's own navigation is there, and accounts can be added by hand.
  await page.goto('/customize#accounts')
  await expect(page.getByRole('button', { name: 'Add an account by hand' })).toBeInViewport()
  await expect(page.getByRole('navigation').first()).toBeVisible()
  await page.context().storageState({ path: OWNER_STATE })
})
