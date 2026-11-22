// Push in this browser: the support check, and turning push on and off
// through a fake service worker. No real push service is reached.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDPOINT, fakePushBrowser, forgetPushBrowser, PUBLIC_KEY } from '../test/notifications'
import {
  browserEnvironment,
  currentEndpoint,
  deviceLabel,
  isAppleMobile,
  keyBytes,
  pushSupport,
  subscribe,
  unsubscribe,
  type PushEnvironment,
} from './push'

afterEach(() => {
  vi.unstubAllGlobals()
  forgetPushBrowser()
})

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'

const desktop: PushEnvironment = {
  userAgent: MAC,
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  permission: 'default',
}

describe('isAppleMobile', () => {
  it('knows an iPhone, and an iPad that asks for the desktop site', () => {
    expect(isAppleMobile({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true)
    expect(isAppleMobile({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true)
  })

  it('leaves a Mac and an Android phone alone', () => {
    expect(isAppleMobile({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false)
    expect(isAppleMobile({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false)
  })
})

describe('pushSupport', () => {
  it('is ready in a desktop browser with push', () => {
    expect(pushSupport(desktop)).toBe('ready')
    expect(pushSupport({ ...desktop, permission: 'granted' })).toBe('ready')
  })

  it('asks an iPhone in Safari to add Leeway to the Home Screen first', () => {
    const iphone = { ...desktop, userAgent: IPHONE, maxTouchPoints: 5, hasPushManager: false }
    expect(pushSupport(iphone)).toBe('home-screen')
    expect(pushSupport({ ...iphone, standalone: true, hasPushManager: true })).toBe('ready')
  })

  it('says when the browser has no push, or no notifications at all', () => {
    expect(pushSupport({ ...desktop, hasServiceWorker: false })).toBe('unsupported')
    expect(pushSupport({ ...desktop, hasPushManager: false })).toBe('unsupported')
    expect(pushSupport({ ...desktop, permission: null })).toBe('unsupported')
  })

  it('says when notifications were blocked', () => {
    expect(pushSupport({ ...desktop, permission: 'denied' })).toBe('denied')
  })
})

describe('browserEnvironment', () => {
  it('reads this browser', () => {
    fakePushBrowser({ permission: 'granted' })
    expect(browserEnvironment()).toMatchObject({
      userAgent: navigator.userAgent,
      standalone: false,
      hasServiceWorker: true,
      hasPushManager: true,
      permission: 'granted',
    })
  })

  it('sees an app opened from the Home Screen, either way Safari says so', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') }))
    expect(browserEnvironment().standalone).toBe(true)
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect(browserEnvironment().standalone).toBe(true)
    Reflect.deleteProperty(navigator, 'standalone')
  })

  it('has no permission to read where there are no notifications', () => {
    expect(browserEnvironment()).toMatchObject({ hasServiceWorker: false, permission: null })
  })
})

describe('keyBytes', () => {
  it('turns base64url into bytes, with or without padding', () => {
    expect([...keyBytes('-_8')]).toEqual([251, 255])
    expect([...keyBytes('AQID')]).toEqual([1, 2, 3])
    expect(keyBytes(PUBLIC_KEY)).toHaveLength(65)
  })
})

describe('deviceLabel', () => {
  it('names the device by its first match', () => {
    expect(deviceLabel(IPHONE)).toBe('iPhone')
    expect(deviceLabel(MAC)).toBe('Mac')
    expect(deviceLabel(ANDROID)).toBe('Android')
    expect(deviceLabel('Something else')).toBe('This device')
  })
})

describe('currentEndpoint', () => {
  it('reads the address of the subscription this browser holds', async () => {
    fakePushBrowser({ permission: 'granted', subscribed: true })
    expect(await currentEndpoint()).toBe(ENDPOINT)
  })

  it('is null when notifications are allowed but nothing is subscribed or registered', async () => {
    fakePushBrowser({ permission: 'granted' })
    expect(await currentEndpoint()).toBeNull()
    forgetPushBrowser()
    fakePushBrowser({ permission: 'granted', registered: false })
    expect(await currentEndpoint()).toBeNull()
  })

  it('never asks the push manager until notifications are allowed', async () => {
    // No subscription can exist yet, and in the WebKit that the browser tests
    // run, getSubscription() blocks the page for good.
    for (const permission of ['default', 'denied'] as const) {
      const browser = fakePushBrowser({ permission, subscribed: true })
      expect(await currentEndpoint()).toBeNull()
      expect(browser.serviceWorker.getRegistration).not.toHaveBeenCalled()
      expect(browser.pushManager.getSubscription).not.toHaveBeenCalled()
      forgetPushBrowser()
    }
  })

  it('is null in a browser without notifications at all', async () => {
    const browser = fakePushBrowser({ subscribed: true })
    vi.stubGlobal('Notification', undefined)
    expect(await currentEndpoint()).toBeNull()
    expect(browser.pushManager.getSubscription).not.toHaveBeenCalled()
  })
})

describe('subscribing', () => {
  it('asks permission, then subscribes with the server key', async () => {
    const browser = fakePushBrowser()
    expect(await currentEndpoint()).toBeNull()
    const device = await subscribe(PUBLIC_KEY)
    expect(browser.requestPermission).toHaveBeenCalled()
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUBLIC_KEY),
    })
    expect(device).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'device-key', auth: 'device-auth' },
      label: deviceLabel(navigator.userAgent),
      origin: window.location.origin,
    })
    expect(await currentEndpoint()).toBe(ENDPOINT)
  })

  it('drops a stale subscription the browser still holds, and makes a fresh one', async () => {
    // The server has none for this browser: its key changed, or the push service said gone.
    const browser = fakePushBrowser({ subscribed: true })
    expect((await subscribe(PUBLIC_KEY))?.endpoint).toBe(ENDPOINT)
    expect(browser.subscription.unsubscribe).toHaveBeenCalled()
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUBLIC_KEY),
    })
    expect(browser.subscription.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      browser.pushManager.subscribe.mock.invocationCallOrder[0]!,
    )
  })

  it('registers the worker first when none runs yet', async () => {
    const browser = fakePushBrowser({ registered: false })
    expect(await currentEndpoint()).toBeNull()
    await subscribe(PUBLIC_KEY)
    expect(browser.serviceWorker.register).toHaveBeenCalledWith('/sw.js')
  })

  it('subscribes nothing when the owner says no', async () => {
    const browser = fakePushBrowser({ answer: 'denied' })
    expect(await subscribe(PUBLIC_KEY)).toBeNull()
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('unsubscribes, handing back the address it had', async () => {
    const browser = fakePushBrowser({ subscribed: true })
    expect(await unsubscribe()).toBe(ENDPOINT)
    expect(browser.subscription.unsubscribe).toHaveBeenCalled()
    expect(await unsubscribe()).toBeNull()
  })
})
