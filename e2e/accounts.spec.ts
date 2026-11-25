// Account health: an overdrawn account warns once, in Heads up, and
// opens on its own page, Home lists every account, Compare accounts adds up
// a saved pick, and a
// low-balance warning set in Settings becomes an alert. Each test removes its
// accounts even when a check fails, since later specs share this install: a
// leftover overdrawn account would change their balances, alerts and idle cash.

import { expect, test, type Page } from '@playwright/test'
import { action, addAccount } from './manual'

/**
 * Deletes every account by these names that was added by hand, however many
 * a failed earlier try left. Any never added are skipped, so it is safe after
 * a failed check; bank accounts are never touched.
 */
async function removeAccounts(page: Page, names: string[]): Promise<void> {
  const accounts = await action<{ id: string; name: string; manual: boolean }[]>(
    page,
    'list_accounts',
  )
  for (const account of accounts) {
    if (account.manual && names.includes(account.name)) {
      await action(page, 'delete_account', { id: account.id })
    }
  }
}

test('an overdrawn account warns on the dashboard and opens on its own', async ({ page }) => {
  try {
    await overdrawnAccountTour(page)
  } finally {
    await removeAccounts(page, ['Everyday', 'Rainy day'])
  }
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByText(/Everyday is overdrawn/)).toHaveCount(0)
})

/** Adds an overdrawn account beside savings and follows its warning through the app. */
async function overdrawnAccountTour(page: Page): Promise<void> {
  await addAccount(page, { name: 'Everyday', balance: '-42.10' })
  await addAccount(page, { name: 'Rainy day', balance: '900' })

  await page.goto('/')
  const headsUp = page.getByRole('region', { name: 'Heads up' })
  await expect(headsUp).toContainText('Everyday is overdrawn by $42.10.')
  // Said once on Home, in Heads up.
  await expect(page.getByText('Everyday is overdrawn by $42.10.')).toHaveCount(1)
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

  // The way back is Home, which lists every account, the overdraft in red.
  await page.locator('.back-link').click()
  await expect(page).toHaveURL(/\/$/)
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true })
  const everyday = accounts.getByRole('link', { name: /^Everyday/ })
  await expect(everyday).toContainText('$42.10')
  await expect(everyday.locator('.money-problem')).toHaveCount(1)
  await expect(accounts.getByRole('link', { name: /^Rainy day/ })).toContainText('$900.00')

  // Compare, from Home's accounts, sums the picked accounts, and the pick is saved.
  await accounts.getByRole('link', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Compare accounts' })).toBeVisible()
  // A tick saves the pick, so each box is read back rather than assumed.
  for (const name of ['Pick Everyday', 'Pick Rainy day']) {
    await page.getByRole('checkbox', { name, exact: true }).click()
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked()
  }
  const bar = page.getByRole('region', { name: 'Picked accounts' })
  await expect(bar).toContainText('2 accounts together')
  await expect(bar).toContainText('$857.90')
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
    '$857.90 available across 2 checking and savings accounts.',
  )
  // No alert card sits beside a pick, so the summary says the overdraft in words, once.
  await expect(page.getByText('Everyday is overdrawn by $42.10.')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Pick Everyday', exact: true })).toBeChecked()
  for (const name of ['Pick Everyday', 'Pick Rainy day']) {
    await page.getByRole('checkbox', { name, exact: true }).click()
    await expect(page.getByRole('checkbox', { name, exact: true })).not.toBeChecked()
  }
  await expect(bar).toContainText('Tick the accounts to add up')

  // The Inbox lists every alert that needs the owner now.
  await page.goto('/inbox')
  await expect(page.getByRole('region', { name: 'Needs you now' })).toContainText(
    'Everyday is overdrawn by $42.10.',
  )
}

test('a low-balance warning set in Settings becomes an alert', async ({ page }) => {
  await addAccount(page, { name: 'Bills', balance: '50' })
  try {
    // A cash account other than checking has no warning until one is set.
    await page.goto('/inbox')
    const now = page.getByRole('region', { name: 'Needs you now' })
    await expect(now).not.toContainText('Loading')
    await expect(now).not.toContainText('Bills is down')

    await page.goto('/settings/accounts')
    const warning = page.getByRole('textbox', { name: 'Low balance warning for Bills' })
    await expect(warning).toHaveAttribute('placeholder', 'Off')
    await warning.fill('100')
    // The box saves when it loses focus. Wait for that save, since leaving the
    // page first can cancel it and the warning would never be set.
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/actions/update_account'))
    await warning.press('Tab')
    expect((await saved).ok()).toBe(true)

    await page.goto('/inbox')
    await expect(page.getByRole('region', { name: 'Needs you now' })).toContainText(
      'Bills is down to $50, below your $100 warning.',
    )
  } finally {
    // Removed even when a check fails, so a leftover low account cannot add an
    // alert to the specs that run after this one.
    await removeAccounts(page, ['Bills'])
  }
})
