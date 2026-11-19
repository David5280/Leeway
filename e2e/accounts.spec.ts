// Account health: an overdrawn account warns at the top of the dashboard and
// opens on the Accounts dashboard, and a low-balance warning set in Settings
// becomes an alert. Each test removes its accounts, since later specs share
// this install.

import { expect, test, type Page } from '@playwright/test'
import { addAccount } from './manual'

/** Deletes accounts added by hand, from Settings. */
async function removeAccounts(page: Page, names: string[]): Promise<void> {
  await page.goto('/settings/accounts')
  for (const name of names) {
    await page.getByRole('button', { name: `Delete ${name}` }).click()
    await expect(page.getByRole('textbox', { name: `Name for ${name}` })).toHaveCount(0)
  }
}

test('an overdrawn account warns on the dashboard and opens on its own', async ({ page }) => {
  await addAccount(page, { name: 'Everyday', balance: '-42.10' })
  await addAccount(page, { name: 'Rainy day', balance: '900' })

  await page.goto('/')
  const banner = page.getByRole('region', { name: 'Account alerts' })
  await expect(banner).toContainText('Everyday is overdrawn by $42.10.')
  await banner.getByRole('link', { name: /Everyday is overdrawn/ }).click()

  // The account opens alone on the Accounts dashboard, and the pick is saved.
  await expect(page).toHaveURL(/\/accounts$/)
  const picker = page.getByRole('group', { name: 'Accounts to show' })
  await expect(picker.getByRole('button', { name: 'Everyday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('-$42.10')
  await page.reload()
  await expect(picker.getByRole('button', { name: 'Everyday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Adding the savings account to the pick sums both; the overdraft still leads.
  await picker.getByRole('button', { name: 'Rainy day' }).click()
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('$857.90')
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )
  await picker.getByRole('button', { name: 'All accounts' }).click()
  await expect(picker.getByRole('button', { name: 'All accounts' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Every alert is a tap away from the banner.
  await page.goto('/')
  await page.getByRole('link', { name: 'See all alerts' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Account alerts' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )

  await removeAccounts(page, ['Everyday', 'Rainy day'])
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Account alerts' })).toHaveCount(0)
})

test('a low-balance warning set in Settings becomes an alert', async ({ page }) => {
  await addAccount(page, { name: 'Bills', balance: '50' })
  // A cash account other than checking has no warning until one is set.
  await page.goto('/alerts')
  await expect(page.getByText(/Every account is fine/)).toBeVisible()

  await page.goto('/settings/accounts')
  const warning = page.getByRole('textbox', { name: 'Low balance warning for Bills' })
  await expect(warning).toHaveAttribute('placeholder', 'Off')
  await warning.fill('100')
  await warning.press('Tab')

  await page.goto('/alerts')
  await expect(page.getByRole('region', { name: 'Account alerts' })).toContainText(
    'Bills is down to $50, below your $100 warning.',
  )

  await removeAccounts(page, ['Bills'])
})
