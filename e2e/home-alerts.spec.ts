// Hiding an account alert from the home screen: gone from Heads up at once,
// and still gone after a reload, while the Inbox keeps it, both under Needs
// you now and among the earlier alerts.

import { expect, test, type Page } from '@playwright/test'
import { action } from './seed'

const NAME = 'Home alert checking'

/** The alert's row in a region of the home screen, with its hide button beside it. */
const rowIn = (page: Page, region: string) =>
  page
    .getByRole('region', { name: region })
    .locator('.alert-hideable')
    .filter({ has: page.getByRole('link', { name: new RegExp(NAME) }) })

test.describe('hiding an alert from home', () => {
  let accountId: string | null = null

  test.afterEach(async ({ request }) => {
    if (accountId) await action(request, 'delete_account', { id: accountId })
    accountId = null
  })

  test('takes it off home only, without opening the account', async ({ page, request }) => {
    const account = await action<{ id: string }>(request, 'create_account', {
      name: NAME,
      type: 'depository',
      balanceCents: -4_200,
    })
    accountId = account.id

    await page.goto('/')
    await expect(rowIn(page, 'Heads up')).toContainText('is overdrawn')

    await rowIn(page, 'Heads up')
      .getByRole('button', { name: new RegExp(`^Hide from home: .*${NAME}`) })
      .click()
    await expect(rowIn(page, 'Heads up')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
    await expect(rowIn(page, 'Heads up')).toHaveCount(0)

    // The Inbox still has it: needing the owner now, and unread among the earlier alerts.
    await page.goto('/inbox')
    const now = page.getByRole('region', { name: 'Needs you now' })
    await expect(now.getByRole('link', { name: new RegExp(NAME) })).toBeVisible()
    const earlier = page.getByRole('region', { name: 'Notifications' })
    await expect(earlier.getByRole('listitem').filter({ hasText: NAME })).toContainText('Unread')
  })
})
