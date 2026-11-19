// Settings: its groups and their addresses, the look and the dashboard,
// connecting an AI assistant, and the weekly email.

import { expect, test } from '@playwright/test'

test('the theme switch changes the look and sticks after a reload', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-mode', 'dark')

  await page.getByRole('button', { name: 'Harbor theme' }).click()
  await expect(html).toHaveAttribute('data-mode', 'light')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Harbor theme' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(html).toHaveAttribute('data-mode', 'light')

  await page.getByRole('button', { name: 'Night theme' }).click()
  await expect(html).toHaveAttribute('data-mode', 'dark')
})

test('each Settings group has its own address, and the menu switches between them', async ({
  page,
}) => {
  await page.goto('/settings/banks')
  const menu = page.getByRole('navigation', { name: 'Settings groups' })
  await expect(page.getByRole('heading', { level: 2, name: 'Banks' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Banks' })).toHaveAttribute('aria-current', 'page')

  await menu.getByRole('link', { name: 'Budgeting' }).click()
  await expect(page).toHaveURL(/\/settings\/budgeting$/)
  await expect(page.getByRole('heading', { level: 3, name: 'Period and warnings' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Banks' })).toHaveCount(0)

  // Back returns to the group before, as with any page.
  await page.goBack()
  await expect(page).toHaveURL(/\/settings\/banks$/)

  // From the keyboard: Tab to a group and press Enter.
  await menu.getByRole('link', { name: 'Data' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible()
})

test('old Customize addresses and unknown groups land on a real group', async ({ page }) => {
  await page.goto('/customize')
  await expect(page).toHaveURL(/\/settings\/[a-z-]+$/)
  await page.goto('/customize/email')
  await expect(page).toHaveURL(/\/settings\/email$/)
  await page.goto('/customize#region')
  await expect(page).toHaveURL(/\/settings\/budgeting#region$/)
  await expect(page.getByRole('region', { name: 'Region' })).toBeInViewport()
  // A group this version does not have opens the one last opened here instead.
  await page.goto('/settings/nowhere')
  await expect(page).toHaveURL(/\/settings\/budgeting$/)
  // The main menu calls it Settings.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Settings' }),
  ).toHaveAttribute('aria-current', 'page')
})

test('Settings reopens the group last opened on this device', async ({ page }) => {
  await page.goto('/settings/data')
  await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible()
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/data$/)
})

test('an accent color applies right away', async ({ page }) => {
  await page.goto('/settings/appearance')
  const accent = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))
  await page.getByRole('radio', { name: 'Teal' }).click()
  await expect.poll(accent).toBe('#2DD4BF')
  await page.getByRole('radio', { name: 'Theme' }).click()
  await expect.poll(accent).not.toBe('#2DD4BF')
})

test('a dashboard card can be hidden and shown again', async ({ page }) => {
  // The switch flips at once, before the save lands; leaving the page too soon
  // would cancel the save, so each click waits for the server to answer.
  const toggleHeadsUp = async () => {
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/actions/update_settings'))
    await page.getByRole('switch', { name: 'Show Heads up' }).click()
    expect((await saved).ok()).toBe(true)
  }

  await page.goto('/settings/appearance')
  await toggleHeadsUp()
  await expect(page.getByRole('switch', { name: 'Show Heads up' })).not.toBeChecked()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Heads up' })).toHaveCount(0)

  await page.goto('/settings/appearance')
  await toggleHeadsUp()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Heads up' })).toBeVisible()
})

test('a key for an AI assistant is shown once, ready to copy', async ({ page }) => {
  await page.goto('/settings/assistant')
  const agent = page.getByRole('region', { name: 'AI assistant' })
  await agent.getByRole('textbox', { name: 'Key name' }).fill('Test assistant')
  await agent.getByRole('button', { name: 'Create a key' }).click()
  await expect(
    agent.getByText('Your new key "Test assistant", shown only once. Copy it now:'),
  ).toBeVisible()
  await expect(agent.getByLabel('New key')).toHaveText(/^lw_/)
})

test('the dashboard summary says how to have Claude write it, and what a missing key means', async ({
  page,
}) => {
  await page.goto('/')
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary).toContainText('Want Claude to write this?')

  await summary.getByRole('link', { name: 'Settings, then AI assistant' }).click()
  const toggle = page.getByRole('switch', { name: 'Have Claude write the dashboard summary' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // The test server has no Anthropic key, so it says how to add one.
  await expect(page.getByText('ANTHROPIC_API_KEY')).toBeVisible()

  await page.goto('/')
  await expect(summary).toContainText('Claude needs an Anthropic key on your server first.')

  // Put it back for the other tests.
  await page.goto('/settings/assistant')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})

test('the weekly email says what the server needs, and keeps its choices for later', async ({
  page,
}) => {
  await page.goto('/settings/email')
  const email = page.getByRole('region', { name: 'Email' })
  const day = email.getByRole('combobox', { name: 'Day' })
  // The test server has no Resend key, so nothing can be sent or turned on yet.
  await expect(email).toContainText('RESEND_API_KEY')
  await expect(email).toContainText('MAIL_FROM')
  await expect(email.getByRole('switch', { name: 'Send me a weekly email' })).toBeDisabled()
  await expect(email.getByRole('button', { name: 'Send a test email now' })).toBeDisabled()
  await expect(email).toContainText('Goes to your sign-in email')

  // The day can still be chosen ahead of time, and it sticks.
  const saved = page.waitForResponse('**/api/actions/set_weekly_email')
  await day.selectOption('Friday')
  expect((await saved).ok()).toBe(true)
  await page.reload()
  await expect(day).toHaveValue('5')

  // Put it back for the other tests.
  await day.selectOption('Monday')
  await expect(day).toHaveValue('1')
})
