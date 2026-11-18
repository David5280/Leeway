// Customizing the look and the dashboard, and connecting an AI assistant.

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

test('an accent color applies right away', async ({ page }) => {
  await page.goto('/customize')
  const accent = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))
  await page.getByRole('radio', { name: 'Teal' }).click()
  await expect.poll(accent).toBe('#2DD4BF')
  await page.getByRole('radio', { name: 'Theme' }).click()
  await expect.poll(accent).not.toBe('#2DD4BF')
})

test('a dashboard card can be hidden and shown again', async ({ page }) => {
  await page.goto('/customize')
  const headsUp = page.getByRole('switch', { name: 'Show Heads up' })
  await headsUp.click()
  await expect(headsUp).not.toBeChecked()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Heads up' })).toHaveCount(0)

  await page.goto('/customize')
  await page.getByRole('switch', { name: 'Show Heads up' }).click()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Heads up' })).toBeVisible()
})

test('a key for an AI assistant is shown once, ready to copy', async ({ page }) => {
  await page.goto('/customize#agent')
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

  await summary.getByRole('link', { name: 'Customize' }).click()
  const toggle = page.getByRole('switch', { name: 'Have Claude write the dashboard summary' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // The test server has no Anthropic key, so it says how to add one.
  await expect(page.getByText('ANTHROPIC_API_KEY')).toBeVisible()

  await page.goto('/')
  await expect(summary).toContainText('Claude needs an Anthropic key on your server first.')

  // Put it back for the other tests.
  await page.goto('/customize#agent')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})
