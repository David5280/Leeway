// The service worker's push handlers, run against a fake worker scope: a
// push shows a notification, and a tap opens its screen in Leeway only.

import workerSource from '../public/sw.js?raw'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: Record<string, unknown>) => void

interface FakeWindow {
  url: string
  focus: () => Promise<FakeWindow>
  navigate: ReturnType<typeof vi.fn>
}

/** Runs sw.js in a scope of fakes; returns them and its listeners by event name. */
function loadWorker(windows: FakeWindow[] = []) {
  const listeners: Record<string, Listener> = {}
  const scope = {
    location: { origin: 'https://leeway.example.com' },
    addEventListener: (name: string, listener: Listener) => (listeners[name] = listener),
    registration: {
      showNotification: vi.fn(async () => {}),
      pushManager: { subscribe: vi.fn(async () => RENEWED) },
    },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
      claim: vi.fn(),
    },
    skipWaiting: vi.fn(),
  }
  new Function('self', 'caches', workerSource)(scope, {})
  return { scope, listeners }
}

/** Dispatches an event and waits for what it handed to waitUntil. */
async function dispatch(listener: Listener | undefined, fields: Record<string, unknown>) {
  let work: Promise<unknown> = Promise.resolve()
  listener?.({ ...fields, waitUntil: (promise: Promise<unknown>) => (work = promise) })
  await work
}

/** A subscription as the Push API gives it. */
function subscription(endpoint: string) {
  return {
    endpoint,
    options: { userVisibleOnly: true, applicationServerKey: new Uint8Array([4]) },
    toJSON: () => ({ endpoint, keys: { p256dh: `${endpoint}-key`, auth: 'auth' } }),
  }
}
const OLD = subscription('https://fcm.googleapis.com/fcm/send/old')
const RENEWED = subscription('https://fcm.googleapis.com/fcm/send/new')

afterEach(() => vi.unstubAllGlobals())

const pushData = (value: unknown) => ({
  json: () => (typeof value === 'string' ? JSON.parse(value) : value),
})

describe('service worker push', () => {
  it('shows the push it gets, keeping the screen to open', async () => {
    const { scope, listeners } = loadWorker()
    const message = {
      title: 'Overdrawn',
      body: 'Everyday is below zero.',
      url: '/alerts',
      tag: 'n1',
    }
    await dispatch(listeners.push, { data: pushData(message) })
    expect(scope.registration.showNotification).toHaveBeenCalledWith('Overdrawn', {
      body: 'Everyday is below zero.',
      tag: 'n1',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: '/alerts' },
    })
  })

  it('shows a plain notice for a push it cannot read', async () => {
    const { scope, listeners } = loadWorker()
    await dispatch(listeners.push, { data: pushData('not json') })
    await dispatch(listeners.push, { data: null })
    await dispatch(listeners.push, { data: pushData({ title: 7 }) })
    for (const [title, options] of scope.registration.showNotification.mock.calls as unknown as [
      string,
      { body: string; data: { url: string } },
    ][]) {
      expect(title).toBe('Leeway')
      expect(options.body).toBe('Something needs a look.')
      expect(options.data.url).toBe('/inbox')
    }
    expect(scope.registration.showNotification).toHaveBeenCalledTimes(3)
  })
})

describe('service worker notification taps', () => {
  const tap = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } })

  it('opens the screen in a new window when Leeway is not open', async () => {
    const { scope, listeners } = loadWorker()
    const event = tap('/budgets/cat-1')
    await dispatch(listeners.notificationclick, event)
    expect(event.notification.close).toHaveBeenCalled()
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/budgets/cat-1')
  })

  it("uses Leeway's open window, focused, for the screen", async () => {
    const open: FakeWindow = {
      url: 'https://leeway.example.com/',
      focus: async () => open,
      navigate: vi.fn(async () => open),
    }
    const other: FakeWindow = {
      url: 'https://elsewhere.example/',
      focus: async () => other,
      navigate: vi.fn(),
    }
    const { scope, listeners } = loadWorker([other, open])
    await dispatch(listeners.notificationclick, tap('/plan/bills?tab=due#rent'))
    expect(open.navigate).toHaveBeenCalledWith('/plan/bills?tab=due#rent')
    expect(other.navigate).not.toHaveBeenCalled()
    expect(scope.clients.openWindow).not.toHaveBeenCalled()
  })

  it.each([
    ['refuses', () => Promise.reject(new TypeError('This service worker is not the client'))],
    ['gives nothing back', async () => null],
  ])(
    'opens a new window when the open one is not this worker’s to steer (navigate %s)',
    async (_, navigate) => {
      const open: FakeWindow = {
        url: 'https://leeway.example.com/',
        focus: async () => open,
        navigate: vi.fn(navigate),
      }
      const { scope, listeners } = loadWorker([open])
      await dispatch(listeners.notificationclick, tap('/alerts'))
      expect(scope.clients.openWindow).toHaveBeenCalledWith('/alerts')
    },
  )

  it('never opens another site, whatever the push says', async () => {
    const { scope, listeners } = loadWorker()
    await dispatch(listeners.notificationclick, tap('https://evil.example/steal'))
    await dispatch(listeners.notificationclick, tap('//evil.example/x'))
    await dispatch(listeners.notificationclick, tap(undefined))
    await dispatch(listeners.notificationclick, { notification: { close: vi.fn(), data: null } })
    await dispatch(listeners.notificationclick, tap('http://[bad'))
    expect(scope.clients.openWindow.mock.calls).toEqual([
      ['/inbox'],
      ['/inbox'],
      ['/inbox'],
      ['/inbox'],
      ['/inbox'],
    ])
  })
})

describe('service worker subscription renewal', () => {
  /** Records each action the worker calls, answering as the server would. */
  function serverCalls() {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{}')
      }),
    )
    return () =>
      calls.map(({ url, init }) => ({
        url,
        credentials: init.credentials,
        body: JSON.parse(String(init.body)),
      }))
  }

  it('hands the server a renewed address and forgets the old one', async () => {
    const sent = serverCalls()
    const { listeners } = loadWorker()
    await dispatch(listeners.pushsubscriptionchange, {
      oldSubscription: OLD,
      newSubscription: RENEWED,
    })
    expect(sent()).toEqual([
      {
        url: '/api/actions/subscribe_push',
        credentials: 'same-origin',
        body: {
          endpoint: RENEWED.endpoint,
          keys: { p256dh: `${RENEWED.endpoint}-key`, auth: 'auth' },
          origin: 'https://leeway.example.com',
        },
      },
      {
        url: '/api/actions/unsubscribe_push',
        credentials: 'same-origin',
        body: { endpoint: OLD.endpoint },
      },
    ])
  })

  it('subscribes again with the old options when the browser gives no new one', async () => {
    const sent = serverCalls()
    const { scope, listeners } = loadWorker()
    await dispatch(listeners.pushsubscriptionchange, { oldSubscription: OLD })
    expect(scope.registration.pushManager.subscribe).toHaveBeenCalledWith(OLD.options)
    expect(sent().map((call) => call.url)).toEqual([
      '/api/actions/subscribe_push',
      '/api/actions/unsubscribe_push',
    ])
  })

  it('keeps the address when it did not change, and does nothing with neither', async () => {
    const sent = serverCalls()
    const { listeners } = loadWorker()
    await dispatch(listeners.pushsubscriptionchange, {
      oldSubscription: RENEWED,
      newSubscription: RENEWED,
    })
    await dispatch(listeners.pushsubscriptionchange, {})
    expect(sent().map((call) => call.url)).toEqual(['/api/actions/subscribe_push'])
  })
})
