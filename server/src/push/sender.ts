// Sending one push message to one device, and what the push service's answer means.

import { HOUR_MS, SECOND_MS } from '../lib/time.js'
import { encryptPayload } from './encrypt.js'
import { vapidAuthorization, type VapidKeys } from './vapid.js'

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
}

/**
 * sent: the push service took it. gone: the subscription has expired or was
 * revoked, so it is removed. retry: try again later (busy or unreachable).
 * rejected: refused for another reason; not worth repeating.
 */
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'rejected'

/** Sends pushes. The real one talks to push services; tests use a fake. */
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
  /** An https address or mailto for push services to contact (see vapidSubject). */
  subject: string
  fetch?: typeof fetch
  now?: () => Date
}

/** Sends Web Push messages: encrypted for the device, signed with the server's VAPID key. */
export class WebPushSender implements PushSender {
  constructor(private readonly options: WebPushOptions) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const keys = await this.options.keys()
    const now = (this.options.now ?? (() => new Date()))()
    const body = encryptPayload(Buffer.from(JSON.stringify(message)), target, {
      padTo: PADDED_BYTES,
    })
    const send = this.options.fetch ?? fetch
    try {
      const response = await send(target.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(target.endpoint, keys, this.options.subject, now),
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
      })
      return outcomeOf(response.status)
    } catch {
      return 'retry'
    }
  }
}
