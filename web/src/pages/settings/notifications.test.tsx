// Settings > Notifications: what to hear about, thresholds, quiet hours, and
// push on this device, with a fake browser and a fake push service.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../../test/fake'
import {
  ENDPOINT,
  fakePushBrowser,
  forgetPushBrowser,
  notificationSettingsHandlers,
  type FakeBrowser,
} from '../../test/notifications'
import type { NotificationsView } from './notifications/notificationText'
import { NotificationsSection } from './Notifications'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  forgetPushBrowser()
})

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

function serve(
  push: Partial<NotificationsView['push']> = {},
  routes: Record<string, () => Response> = {},
) {
  return fakeServer(notificationSettingsHandlers(push), routes)
}

/** Renders the section with a browser that has push, and waits for it to load. */
async function renderSection(browser: FakeBrowser | null = {}) {
  const fake = browser ? fakePushBrowser(browser) : null
  renderSignedIn(<NotificationsSection />)
  await screen.findByRole('switch', { name: 'Notify me: Overdrawn' })
  return fake
}

const kindSwitch = (label: string) => screen.getByRole('switch', { name: `Notify me: ${label}` })
const turnOn = () => screen.getByRole('button', { name: 'Turn on' })

describe('NotificationsSection: what to hear about', () => {
  it('lists every kind the server raises, all on, with their thresholds', async () => {
    serve()
    await renderSection()
    const labels = ['Overdrawn', 'Low balance', 'Budgets', 'Bills due', 'Large charges', 'AI limit']
    for (const label of labels) {
      expect(kindSwitch(label)).toHaveAttribute('aria-checked', 'true')
    }
    expect(screen.getByRole('combobox', { name: 'Share of a budget' })).toHaveDisplayValue('100%')
    expect(screen.getByRole('combobox', { name: 'When a bill is due' })).toHaveDisplayValue(
      '2 days before',
    )
    expect(screen.getByRole('textbox', { name: 'Amount of a large charge' })).toHaveValue('500')
  })

  it('turns a kind off at once, hiding its threshold', async () => {
    const server = serve()
    await renderSection()
    const release = holdRequest('/api/actions/update_notification_settings')
    await userEvent.click(kindSwitch('Budgets'))
    expect(kindSwitch('Budgets')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('combobox', { name: 'Share of a budget' })).not.toBeInTheDocument()
    release()
    await waitFor(() =>
      expect(server.actions('update_notification_settings')).toEqual([
        { kinds: { over_budget: false } },
      ]),
    )
  })

  it('saves thresholds as they are picked', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Share of a budget' }), '80%')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'When a bill is due' }),
      'On the day',
    )
    await waitFor(() =>
      expect(server.actions('update_notification_settings')).toEqual([
        { overBudgetPercent: 80 },
        { billDueDays: 0 },
      ]),
    )
  })

  it('saves a large charge amount when the box is left, and puts back one out of range', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    const box = screen.getByRole('textbox', { name: 'Amount of a large charge' })
    await user.clear(box)
    await user.type(box, '0.5')
    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Amount of a large charge' })).toHaveValue('500')
    await user.clear(screen.getByRole('textbox', { name: 'Amount of a large charge' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount of a large charge' }), '500')
    await user.tab()
    expect(server.actions('update_notification_settings')).toEqual([])
    await user.clear(screen.getByRole('textbox', { name: 'Amount of a large charge' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount of a large charge' }), '$1,200')
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_notification_settings')).toEqual([
        { largeTransactionCents: 120_000 },
      ]),
    )
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Amount of a large charge' })).toHaveValue('1200'),
    )
  })

  it('sets quiet hours in the owner time zone', async () => {
    const server = serve()
    await renderSection()
    expect(screen.getByText(/In your time zone, America\/Denver/)).toBeInTheDocument()
    const user = userEvent.setup()
    expect(screen.getByRole('combobox', { name: 'Quiet from' })).toHaveDisplayValue('From 10 PM')
    expect(screen.getByRole('combobox', { name: 'Quiet until' })).toHaveDisplayValue('Until 7 AM')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Quiet from' }), 'From 11 PM')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Quiet until' }), 'Until 6 AM')
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }))
    await waitFor(() =>
      expect(server.actions('update_notification_settings')).toEqual([
        { quietHours: { start: 23 } },
        { quietHours: { end: 6 } },
        { quietHours: { on: false } },
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Quiet from' })).not.toBeInTheDocument(),
    )
  })

  it('says why a change was refused', async () => {
    serve({}, { '/api/actions/update_notification_settings': failing('Too high') })
    await renderSection()
    await userEvent.click(kindSwitch('Overdrawn'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too high')
  })

  it('says why the settings could not load', async () => {
    serve({}, { '/api/actions/get_notification_settings': failing('The server is down', 500) })
    fakePushBrowser()
    renderSignedIn(<NotificationsSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading notification settings')
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down')
  })
})

describe('NotificationsSection: push on this device', () => {
  it('turns push on, asking the browser and handing the server the subscription', async () => {
    const server = serve()
    const browser = await renderSection()
    expect(screen.getByText('No device gets pushes yet.')).toBeInTheDocument()
    await userEvent.click(turnOn())
    await screen.findByRole('button', { name: 'Turn off' })
    expect(browser?.requestPermission).toHaveBeenCalled()
    expect(server.actions('subscribe_push')).toEqual([
      {
        endpoint: ENDPOINT,
        keys: { p256dh: 'device-key', auth: 'device-auth' },
        label: expect.any(String),
        origin: window.location.origin,
      },
    ])
    expect(await screen.findByText('Push is on for this device.')).toBeInTheDocument()
  })

  it('sends a test push to this device', async () => {
    const server = serve({ thisDevice: true, devices: 1 })
    await renderSection({ subscribed: true, permission: 'granted' })
    expect(await screen.findByText('Push is on for this device and 1 other.')).toBeInTheDocument()
    const release = holdRequest('/api/actions/send_test_push')
    await userEvent.click(screen.getByRole('button', { name: 'Send a test notification' }))
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled()
    release()
    expect(await screen.findByText('Sent. It should show on this device shortly.')).toBeVisible()
    expect(server.actions('send_test_push')).toEqual([{ endpoint: ENDPOINT }])
  })

  it('says why a test push failed', async () => {
    serve(
      { thisDevice: true },
      { '/api/actions/send_test_push': failing('The push service refused it', 502) },
    )
    await renderSection({ subscribed: true, permission: 'granted' })
    await userEvent.click(await screen.findByRole('button', { name: 'Send a test notification' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The push service refused it')
  })

  it('turns push off here, telling the server to forget this device', async () => {
    const server = serve({ thisDevice: true })
    const browser = await renderSection({ subscribed: true, permission: 'granted' })
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    await screen.findByRole('button', { name: 'Turn on' })
    expect(browser?.subscription.unsubscribe).toHaveBeenCalled()
    expect(server.actions('unsubscribe_push')).toEqual([{ endpoint: ENDPOINT }])
  })

  it('still turns off when the browser had already dropped its subscription', async () => {
    const server = serve({ thisDevice: true })
    const browser = await renderSection({ subscribed: true, permission: 'granted' })
    await screen.findByRole('button', { name: 'Turn off' })
    browser?.pushManager.getSubscription.mockResolvedValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(server.actions('unsubscribe_push')).toEqual([])
  })

  it('explains when the owner says no to notifications', async () => {
    const server = serve()
    await renderSection({ answer: 'denied' })
    await userEvent.click(turnOn())
    expect(await screen.findByText(/Notifications are blocked for Leeway/)).toBeVisible()
    expect(turnOn()).toBeDisabled()
    expect(server.actions('subscribe_push')).toEqual([])
  })

  it('says in one line why the server refused this browser, and leaves it unsubscribed', async () => {
    serve(
      {},
      {
        '/api/actions/subscribe_push': failing(
          'endpoint: This browser uses a push service Leeway does not know',
        ),
      },
    )
    const browser = await renderSection()
    await userEvent.click(turnOn())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Push stays off on this browser. This browser uses a push service Leeway does not know.',
    )
    expect(browser?.subscription.unsubscribe).toHaveBeenCalled()
    expect(turnOn()).toBeEnabled()
  })

  it('says why push could not be turned on for any other reason, as the server says it', async () => {
    serve(
      {},
      {
        '/api/actions/subscribe_push': () =>
          Response.json({ error: 'internal', message: 'The server is down' }, { status: 500 }),
      },
    )
    const browser = await renderSection()
    browser?.subscription.unsubscribe.mockRejectedValue(new Error('already gone'))
    await userEvent.click(turnOn())
    expect(await screen.findByRole('alert')).toHaveTextContent(/^The server is down$/)
  })

  it('says why push could not be turned off', async () => {
    const browser = fakePushBrowser({ subscribed: true, permission: 'granted' })
    browser.subscription.unsubscribe.mockRejectedValue(new Error('The browser said no'))
    serve({ thisDevice: true })
    renderSignedIn(<NotificationsSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The browser said no')
  })

  it('tells an iPhone in Safari, in one line, to add Leeway to the Home Screen', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
    serve()
    await renderSection(null)
    expect(
      screen.getByText(
        'On iPhone and iPad, add Leeway to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.',
      ),
    ).toBeVisible()
    expect(turnOn()).toBeDisabled()
  })

  it('says when the browser has no push, and the inbox still works', async () => {
    serve()
    await renderSection(null)
    expect(screen.getByText(/This browser can't show notifications/)).toBeVisible()
    expect(turnOn()).toBeDisabled()
  })

  it('opens without asking the push manager while notifications are not yet allowed', async () => {
    // The worker registers on every page load, so it is there before the owner
    // ever turns push on. Asking it for a subscription then finds none, and
    // blocked WebKit's page for good in the browser tests.
    const server = serve()
    const browser = await renderSection({ subscribed: true })
    expect(turnOn()).toBeEnabled()
    expect(browser?.pushManager.getSubscription).not.toHaveBeenCalled()
    expect(server.actions('get_notification_settings')).toEqual([{}])
  })

  it('goes on without this device when the worker cannot be asked', async () => {
    // Allowed, so the worker is asked for this device's subscription.
    const browser = fakePushBrowser({ permission: 'granted' })
    browser.serviceWorker.getRegistration.mockRejectedValue(new Error('no worker'))
    serve()
    renderSignedIn(<NotificationsSection />)
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeEnabled()
    expect(browser.serviceWorker.getRegistration).toHaveBeenCalled()
  })
})
