// Push in this browser: whether it can, and turning it on and off. The
// subscription is made against the server's public key and handed to the
// server; the browser keeps its own half.

/**
 * ready: push can be turned on here. home-screen: an iPhone or iPad, where
 * push works only once Leeway is added to the Home Screen and opened from
 * there. unsupported: this browser has no Web Push. denied: notifications
 * were blocked for this site in the browser's settings.
 */
export type PushSupport = 'ready' | 'home-screen' | 'unsupported' | 'denied'

/** What the support check reads from the browser; tests pass their own. */
export interface PushEnvironment {
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  permission: NotificationPermission | null
}

/** iPhone and iPad, including an iPad that asks for the desktop site (it says it is a Mac). */
export function isAppleMobile(env: Pick<PushEnvironment, 'userAgent' | 'maxTouchPoints'>): boolean {
  return (
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  )
}

export function pushSupport(env: PushEnvironment): PushSupport {
  // Safari on iOS has push only for a site added to the Home Screen and opened from there.
  if (isAppleMobile(env) && !env.standalone) return 'home-screen'
  if (!env.hasServiceWorker || !env.hasPushManager || env.permission === null) return 'unsupported'
  if (env.permission === 'denied') return 'denied'
  return 'ready'
}

/** This browser, as pushSupport reads it. */
export function browserEnvironment(): PushEnvironment {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    permission: 'Notification' in window ? Notification.permission : null,
  }
}

/** The server's key as the Push API takes it: the raw bytes of a base64url string. */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/**
 * The service worker's push manager, registering the worker if the app has
 * not yet (it registers on load in a built app) and waiting until it runs.
 */
async function pushManager(): Promise<PushManager> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register('/sw.js')
  }
  return (await navigator.serviceWorker.ready).pushManager
}

/** This browser's push address, or null when push is off here (or no worker runs yet). */
export async function currentEndpoint(): Promise<string | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}

/** A subscription as the server takes it. */
export interface DeviceSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  label: string
  /** Where Leeway is open, which push services may contact (see the server's vapidSubject). */
  origin: string
}

/** A name for this device, like "iPhone" or "Mac", by its first match. */
export function deviceLabel(userAgent: string): string {
  const devices = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux']
  return devices.find((device) => userAgent.includes(device)) ?? 'This device'
}

/**
 * Asks the browser's permission, then subscribes with the server's key.
 * Returns null when the owner said no to notifications.
 *
 * Push is turned on only where the server has no subscription for this
 * browser, so one the browser still holds is stale: made with a key the
 * server has since replaced, or reported gone by its push service. It is
 * dropped and a fresh one made, never handed back to the server.
 */
export async function subscribe(publicKey: string): Promise<DeviceSubscription | null> {
  if ((await Notification.requestPermission()) !== 'granted') return null
  const manager = await pushManager()
  await (await manager.getSubscription())?.unsubscribe()
  const subscription = await manager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  })
  const { keys } = subscription.toJSON() as { keys: { p256dh: string; auth: string } }
  return {
    endpoint: subscription.endpoint,
    keys,
    label: deviceLabel(navigator.userAgent),
    origin: window.location.origin,
  }
}

/** Stops push in this browser; returns the address it had, to tell the server. */
export async function unsubscribe(): Promise<string | null> {
  const subscription = await (await pushManager()).getSubscription()
  if (!subscription) return null
  await subscription.unsubscribe()
  return subscription.endpoint
}
