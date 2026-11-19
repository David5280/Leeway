// Stand-ins for the browser tests of notifications. No test reaches a real
// push service: the browser's push plumbing is faked in the page, and the
// push actions that would store or reach a device are answered here, so the
// server never holds a push address and its notifier has nothing to send.

import type { Page, Route } from '@playwright/test'
import { LONG } from './seed'

/** The address the fake browser subscribes with; it is never sent to the server. */
export const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-device'

/** A Safari on an iPhone, as it reports itself before Leeway is on the Home Screen. */
export const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

/**
 * Fakes push in the page before it loads: notification permission is granted
 * when asked, and a service worker whose push manager subscribes at once.
 * What the page asked for is kept on window.pushCalls.
 */
export async function fakePushBrowser(page: Page, options: { subscribed?: boolean } = {}) {
  await page.addInitScript(
    ({ endpoint, subscribed }) => {
      const calls: { subscribe: unknown[]; unsubscribe: number } = { subscribe: [], unsubscribe: 0 }
      let current = subscribed
      const subscription = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BPdevicekey', auth: 'deviceauth' } }),
        unsubscribe: async () => {
          calls.unsubscribe += 1
          current = false
          return true
        },
      }
      const pushManager = {
        getSubscription: async () => (current ? subscription : null),
        subscribe: async (options: { applicationServerKey: Uint8Array }) => {
          calls.subscribe.push(options.applicationServerKey.length)
          current = true
          return subscription
        },
      }
      const registration = { pushManager }
      let permission = 'default'
      Object.assign(window, { pushCalls: calls, PushManager: function PushManager() {} })
      Object.defineProperty(window, 'Notification', {
        value: {
          get permission() {
            return permission
          },
          requestPermission: async () => (permission = 'granted'),
        },
      })
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      })
    },
    { endpoint: FAKE_ENDPOINT, subscribed: options.subscribed ?? false },
  )
}

/**
 * Answers the push actions that would store or reach a device, keeping
 * whether push is on for the fake device. The settings themselves still come
 * from the server; only whether this device has push is filled in here.
 */
export async function fakePushServer(page: Page, options: { subscribed?: boolean } = {}) {
  const state = { on: options.subscribed ?? false, tests: 0, subscribed: [] as unknown[] }
  await page.route('**/api/actions/get_notification_settings', async (route) => {
    const response = await route.fetch()
    const { result } = await response.json()
    const push = { ...result.push, thisDevice: state.on, devices: state.on ? 1 : 0 }
    await route.fulfill({ response, json: { result: { ...result, push } } })
  })
  const answerWithView = (on: boolean) => async (route: Route) => {
    if (on) state.subscribed.push(route.request().postDataJSON())
    state.on = on
    const view = await page.request.post('/api/actions/get_notification_settings', { data: {} })
    const { result } = await view.json()
    const push = { ...result.push, thisDevice: on, devices: on ? 1 : 0 }
    await route.fulfill({ json: { result: { ...result, push } } })
  }
  await page.route('**/api/actions/subscribe_push', answerWithView(true))
  await page.route('**/api/actions/unsubscribe_push', answerWithView(false))
  await page.route('**/api/actions/send_test_push', async (route) => {
    state.tests += 1
    await route.fulfill({ json: { result: { devices: 1 } } })
  })
  return state
}

/** Alerts with the longest names Leeway takes, for the layout guard's inbox. */
export async function fakeLongInbox(page: Page) {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  const items = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'overdrawn',
      title: 'Overdrawn',
      message: `${LONG.account} is at -$1,240.18.`,
      link: '/alerts',
      createdAt: at(4),
      readAt: null,
      resolvedAt: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'over_budget',
      title: 'Over budget',
      message: `${LONG.category} is at $182 of its $120 budget.`,
      link: '/budgets',
      createdAt: at(90),
      readAt: null,
      resolvedAt: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      kind: 'bill_due',
      title: 'Bill due soon',
      message: `${LONG.bill} ($24) is due tomorrow.`,
      link: '/plan/bills',
      createdAt: at(60 * 30),
      readAt: at(60 * 20),
      resolvedAt: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      kind: 'low_balance',
      title: 'Low balance',
      message: `${LONG.account} is below your $100 warning.`,
      link: '/alerts',
      createdAt: at(60 * 50),
      readAt: at(60 * 49),
      resolvedAt: at(60 * 48),
    },
  ]
  await page.route('**/api/actions/list_notifications', (route) =>
    route.fulfill({ json: { result: { items, unread: 2 } } }),
  )
  await page.route('**/api/actions/count_notifications', (route) =>
    route.fulfill({ json: { result: { unread: 2 } } }),
  )
}
