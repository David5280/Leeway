// Browser push subscriptions for tests: real P-256 keys, made fresh, so the
// server's checks and encryption accept them. No push service is involved.

import { createECDH, randomBytes } from 'node:crypto'
import type { SubscriptionInput } from '../../src/push/subscriptions.js'

/** A browser's keys, as PushSubscription.toJSON() gives them. */
export function deviceKeys(): { p256dh: string; auth: string } {
  const pair = createECDH('prime256v1')
  pair.generateKeys()
  return {
    p256dh: pair.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}

export function subscriptionFor(endpoint: string): SubscriptionInput {
  return { endpoint, keys: deviceKeys() }
}
