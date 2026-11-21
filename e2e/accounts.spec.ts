// Account health: an overdrawn account warns once, in Heads up, and
// opens on its own page, Select on Accounts adds up a saved pick, and a
// low-balance warning set in Settings becomes an alert. Each test removes its
// accounts, since later specs share this install.

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
  const headsUp = page.getByRole('region', { name: 'Heads up' })
  await expect(headsUp).toContainText('Everyday is overdrawn by $42.10.')
  // Said once: no banner above the hero, only Heads up.
  await expect(page.getByText('Everyday is overdrawn by $42.10.')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Account alerts' })).toHaveCount(0)
  await headsUp.getByRole('link', { name: /Everyday is overdrawn/ }).click()

  // The alert opens the account's own page, which leads with the overdraft.
  await expect(page).toHaveURL(/\/accounts\/[\w-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Everyday' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Everyday balance' })).toContainText(
    /Overdrawn by\s*\$42\.10/,
  )
  await expect(page.getByRole('region', { name: 'Alerts for this account' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )

  // On Accounts, picking both sums them, and the pick is saved.
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Select' }).click()
  // A tick saves the pick, so each box is read back rather than assumed.
  for (const name of ['Pick Everyday', 'Pick Rainy day']) {
    await page.getByRole('checkbox', { name }).click()
    await expect(page.getByRole('checkbox', { name })).toBeChecked()
  }
  const bar = page.getByRole('region', { name: 'Picked accounts' })
  await expect(bar).toContainText('2 accounts together')
  await expect(bar).toContainText('$857.90')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
    '$857.90 available across 2 checking and savings accounts.',
  )
  await expect(page.getByText('Everyday is overdrawn by $42.10.')).toHaveCount(1)
  await page.reload()
  await page.getByRole('button', { name: 'Select' }).click()
  await expect(page.getByRole('checkbox', { name: 'Pick Everyday' })).toBeChecked()
  for (const name of ['Pick Everyday', 'Pick Rainy day']) {
    await page.getByRole('checkbox', { name }).click()
    await expect(page.getByRole('checkbox', { name })).not.toBeChecked()
  }
  await expect(bar).toContainText('Tick the accounts to add up')
  await page.getByRole('button', { name: 'Done' }).click()

  // The Alerts page lists every alert.
  await page.goto('/alerts')
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Account alerts' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )

  await removeAccounts(page, ['Everyday', 'Rainy day'])
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByText(/Everyday is overdrawn/)).toHaveCount(0)
})

test('a low-balance warning set in Settings becomes an alert', async ({ page }) => {
  await addAccount(page, { name: 'Bills', balance: '50' })
  try {
    // A cash account other than checking has no warning until one is set.
    await page.goto('/alerts')
    await expect(page.getByText(/Every account is fine/)).toBeVisible()

    await page.goto('/settings/accounts')
    const warning = page.getByRole('textbox', { name: 'Low balance warning for Bills' })
    await expect(warning).toHaveAttribute('placeholder', 'Off')
    await warning.fill('100')
    // The box saves when it loses focus. Wait for that save, since leaving the
    // page first can cancel it and the warning would never be set.
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/actions/update_account'))
    await warning.press('Tab')
    expect((await saved).ok()).toBe(true)

    await page.goto('/alerts')
    await expect(page.getByRole('region', { name: 'Account alerts' })).toContainText(
      'Bills is down to $50, below your $100 warning.',
    )
  } finally {
    // Removed even when a check fails, so a leftover low account cannot add an
    // alert to the specs that run after this one.
    await removeAccounts(page, ['Bills'])
  }
})
