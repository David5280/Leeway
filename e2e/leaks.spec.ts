// Money leaks among the account alerts: a charge that went through twice and
// a repeating charge that went up in price, each on the Alerts page, opening
// that merchant's charges on the account, side by side.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { action } from './seed'

/** A date this many days before today, as the server takes it. */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

/** Adds charges on the account, as [days ago, cents]. */
async function charge(
  request: APIRequestContext,
  accountId: string,
  name: string,
  charges: [number, number][],
) {
  for (const [days, amountCents] of charges) {
    await action(request, 'create_transaction', {
      accountId,
      date: daysAgo(days),
      name,
      amountCents,
    })
  }
}

test.describe('money leaks', () => {
  let accountId: string | null = null

  test.beforeEach(async ({ request }) => {
    const account = await action<{ id: string }>(request, 'create_account', {
      name: 'Leaky checking',
      type: 'depository',
      balanceCents: 300_000,
    })
    accountId = account.id
  })

  test.afterEach(async ({ request }) => {
    // Deleting the account deletes its charges, and the alerts go with them.
    if (accountId) await action(request, 'delete_account', { id: accountId })
    accountId = null
  })

  test('a charge made twice opens both charges on its account', async ({ page, request }) => {
    await charge(request, accountId!, 'Corner Hardware', [
      [6, 4_210],
      [5, 4_210],
    ])
    await page.goto('/alerts')
    const alert = page.getByRole('link', { name: /Corner Hardware charged \$42\.10 twice/ })
    await expect(alert).toBeVisible()
    await alert.click()
    await expect(page).toHaveURL(/\/transactions\?account=.+&range=all&search=Corner\+Hardware/)
    await expect(page.getByRole('searchbox', { name: 'Search transactions' })).toHaveValue(
      'Corner Hardware',
    )
    const list = page.getByRole('region', { name: 'Transaction list' })
    await expect(
      list.getByRole('button', { name: /^Corner Hardware, spent \$42\.10/ }),
    ).toHaveCount(2)
  })

  test('a repeating charge that went up says from what to what', async ({ page, request }) => {
    await charge(request, accountId!, 'Streamly', [
      [95, 1_099],
      [65, 1_099],
      [35, 1_099],
      [5, 1_199],
    ])
    await page.goto('/alerts')
    await expect(
      page.getByRole('link', { name: /Streamly went up to \$11\.99, from \$10\.99/ }),
    ).toBeVisible()
  })
})
