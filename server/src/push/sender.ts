// Sending one push message to one device, and what the push service's answer means.

import { HOUR_MS, MINUTE_MS, SECOND_MS } from '../lib/time.js'
import { encryptPayload } from './encrypt.js'
import { vapidAuthorization, vapidSubject, type VapidKeys } from './vapid.js'

/**
 * What a push carries, and all it carries. The service worker shows the
 * title and body and opens `url` on a tap; the inbox has the detail.
 */
export interface PushMessage {
  title: string
  body: string
  /** A path in the app, like /inbox. */
  url: string
  /** Notifications with the same tag replace each other on the device. */
  tag: string
}

/** Where to send: a stored subscription. */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
  /** The address the device subscribed from, a contact for push services (see vapidSubject). */
  origin: string | null
}

/**
 * sent: the push service took it. gone: the subscription has expired or was
 * revoked, so it is removed. retry: try again later (busy or unreachable).
 * rejected: refused, or the device's keys can't be used; not worth repeating.
 */
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'rejected'

export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>
}

/** Every message is padded to this size, so its length says nothing about the alert. */
export const PADDED_BYTES = 512
/** How long a push service holds a message for a device that is offline. */
const TTL_SECONDS = (24 * HOUR_MS) / SECOND_MS
const TIMEOUT_MS = 10 * SECOND_MS

export function outcomeOf(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || status >= 500) return 'retry'
  return 'rejected'
}

export interface WebPushOptions {
  /** The server's key pair, loaded when needed (see keys.ts). */
  keys: () => Promise<VapidKeys>
  /** PUBLIC_URL, which push services may contact when it is https (see vapidSubject). */
  publicUrl: string | null
  fetch?: typeof fetch
  now?: () => Date
}

/** How long loaded keys are reused, so a push to every device reads and decrypts them once. */
export const KEYS_REUSED_MS = MINUTE_MS

/** Sends Web Push messages: encrypted for the device, signed with the server's VAPID key. */
export class WebPushSender implements PushSender {
  private loaded: { keys: Promise<VapidKeys>; until: number } | null = null

  constructor(private readonly options: WebPushOptions) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const now = (this.options.now ?? (() => new Date()))()
    let keys: VapidKeys
    try {
      keys = await this.keys(now)
    } catch {
      // The server's own keys, not the device: worth another try later.
      return 'retry'
    }
    let request: RequestInit
    try {
      request = this.request(target, message, keys, now)
    } catch {
      // Keys the device sent that can't be used: no later try would work.
      return 'rejected'
    }
    try {
      const response = await (this.options.fetch ?? fetch)(target.endpoint, request)
      return outcomeOf(response.status)
    } catch {
      return 'retry'
    }
  }

  /** The key pair, loaded once and reused for a minute; a failed load is not kept. */
  private keys(now: Date): Promise<VapidKeys> {
    if (!this.loaded || now.getTime() >= this.loaded.until) {
      const keys = this.options.keys()
      keys.catch(() => {
        if (this.loaded?.keys === keys) this.loaded = null
      })
      this.loaded = { keys, until: now.getTime() + KEYS_REUSED_MS }
    }
    return this.loaded.keys
  }

  private request(
    target: PushTarget,
    message: PushMessage,
    keys: VapidKeys,
    now: Date,
  ): RequestInit {
    const body = encryptPayload(Buffer.from(JSON.stringify(message)), target, {
      padTo: PADDED_BYTES,
    })
    const subject = vapidSubject(this.options.publicUrl, target.origin)
    return {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(target.endpoint, keys, subject, now),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL_SECONDS),
        Urgency: 'normal',
        // A device that was offline gets the newest push, not every one it missed.
        Topic: 'leeway',
      },
      // A plain byte array: the web app's DOM types do not take a Buffer.
      body: new Uint8Array(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  }
}
