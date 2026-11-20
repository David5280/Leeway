// Hiding an account alert from the home screen: gone from the banner and from
// Heads up at once, and still gone after a reload, while the inbox and the
// Alerts page keep it.

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
    await expect(rowIn(page, 'Account alerts')).toContainText('is overdrawn')
    await expect(rowIn(page, 'Heads up')).toContainText('is overdrawn')

    await rowIn(page, 'Account alerts')
      .getByRole('button', { name: new RegExp(`^Hide from home: .*${NAME}`) })
      .click()
    await expect(rowIn(page, 'Account alerts')).toHaveCount(0)
    await expect(rowIn(page, 'Heads up')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Heads up' })).toBeVisible()
    await expect(rowIn(page, 'Heads up')).toHaveCount(0)

    // The inbox still has it, unread, and so does the Alerts page.
    await page.goto('/inbox')
    const item = page.getByRole('listitem').filter({ hasText: NAME })
    await expect(item).toContainText('Unread')
    await page.goto('/alerts')
    await expect(page.getByRole('link', { name: new RegExp(NAME) })).toBeVisible()
  })
})
