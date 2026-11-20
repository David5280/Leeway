// Notifications: an alert reaching the inbox and the bell, the settings
// saved on the server, and push on this device with a fake browser and a
// fake push service (notifications.ts), so no test reaches a real one.

import { expect, test } from '@playwright/test'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../server/src/domain/notifications/settings'
import { fakePushBrowser, fakePushServer, IPHONE_SAFARI } from './notifications'
import { action } from './seed'

test.describe('the inbox', () => {
  let accountId: string | null = null

  test.afterEach(async ({ request }) => {
    if (accountId) await action(request, 'delete_account', { id: accountId })
    accountId = null
  })

  test('an overdrawn account shows in the inbox and on the bell, and opens its screen', async ({
    page,
    request,
  }) => {
    const account = await action<{ id: string }>(request, 'create_account', {
      name: 'Inbox test checking',
      type: 'depository',
      balanceCents: -4_200,
    })
    accountId = account.id

    await page.goto('/inbox')
    const item = page.getByRole('listitem').filter({ hasText: 'Inbox test checking' })
    await expect(item).toContainText('Overdrawn')
    await expect(item).toContainText('Unread')
    await expect(page.getByRole('link', { name: /^Inbox, \d+ unread$/ })).toBeVisible()

    await item.getByRole('link', { name: /^Open Overdrawn: / }).click()
    await expect(page).toHaveURL(/\/alerts$/)
    await page
      .getByRole('banner')
      .getByRole('link', { name: /^Inbox/ })
      .click()
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(item).not.toContainText('Unread')

    await item.getByRole('button', { name: /^Dismiss Overdrawn: / }).click()
    await expect(item).toHaveCount(0)
  })

  test('marks everything read at once', async ({ page, request }) => {
    const account = await action<{ id: string }>(request, 'create_account', {
      name: 'Inbox test savings',
      type: 'depository',
      balanceCents: -100,
    })
    accountId = account.id
    await page.goto('/inbox')
    await expect(page.getByRole('listitem').filter({ hasText: 'Inbox test savings' })).toBeVisible()
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible()
  })
})

test.describe('Settings > Notifications', () => {
  test.afterEach(async ({ request }) => {
    // Back as a fresh install has them, for the tests after.
    const { kinds, quietHours, ...thresholds } = DEFAULT_NOTIFICATION_SETTINGS
    await action(request, 'update_notification_settings', { kinds, quietHours, ...thresholds })
  })

  test('saves each choice on the server', async ({ page, request }) => {
    await page.goto('/settings/notifications')
    await page.getByRole('switch', { name: 'Notify me: Budgets' }).click()
    await expect(page.getByLabel('Share of a budget')).toHaveCount(0)
    await page.getByLabel('When a bill is due').selectOption({ label: '5 days before' })
    const amount = page.getByLabel('Amount of a large charge')
    await amount.fill('1200')
    await amount.blur()
    await page.getByLabel('Quiet from').selectOption({ label: 'From 11 PM' })

    await expect
      .poll(
        async () =>
          (await action<{ settings: unknown }>(request, 'get_notification_settings')).settings,
      )
      .toMatchObject({
        kinds: { over_budget: false, overdrawn: true },
        billDueDays: 5,
        largeTransactionCents: 120_000,
        quietHours: { on: true, start: 23, end: 7 },
      })
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Notify me: Budgets' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await expect(page.getByLabel('Amount of a large charge')).toHaveValue('1200')
  })

  test('turns push on for this device, sends a test, and turns it off', async ({ page }) => {
    await fakePushBrowser(page)
    const server = await fakePushServer(page)
    await page.goto('/settings/notifications')
    await expect(page.getByText('No device gets pushes yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Turn on' }).click()
    await expect(page.getByText('Push is on for this device.')).toBeVisible()
    // Subscribed with the server's own public key: 65 bytes, an uncompressed P-256 point.
    expect(
      await page.evaluate(
        () => (window as unknown as { pushCalls: { subscribe: number[] } }).pushCalls.subscribe,
      ),
    ).toEqual([65])
    expect(server.subscribed).toEqual([
      expect.objectContaining({ keys: { p256dh: 'BPdevicekey', auth: 'deviceauth' } }),
    ])

    await page.getByRole('button', { name: 'Send a test notification' }).click()
    await expect(page.getByText('Sent. It should show on this device shortly.')).toBeVisible()
    expect(server.tests).toBe(1)

    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeEnabled()
    await expect(page.getByText('No device gets pushes yet.')).toBeVisible()
  })

  test.describe('in Safari on an iPhone, before Leeway is on the Home Screen', () => {
    test.use({ userAgent: IPHONE_SAFARI })

    test('says in one line to add it to the Home Screen first', async ({ page }) => {
      await page.goto('/settings/notifications')
      await expect(
        page.getByText(
          'On iPhone and iPad, add Leeway to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.',
        ),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Turn on' })).toBeDisabled()
    })
  })
})
