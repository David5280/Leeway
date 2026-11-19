// The service worker's push handlers, run against a fake worker scope: a
// push shows a notification, and a tap opens its screen in Leeway only.

import workerSource from '../public/sw.js?raw'
import { describe, expect, it, vi } from 'vitest'

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
    registration: { showNotification: vi.fn(async () => {}) },
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
      navigate: vi.fn(),
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
