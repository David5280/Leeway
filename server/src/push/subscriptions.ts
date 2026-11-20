// The devices that turned push on, one row per browser.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { receiverKeyBytes } from './encrypt.js'

/**
 * The push services browsers use. The server posts to whatever endpoint a
 * browser hands it, so only these hosts are accepted: the server can never be
 * pointed at an address on its own network.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
]

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  )
}

export const endpointSchema = z
  .string()
  .max(1000)
  .refine(isPushEndpoint, 'This browser uses a push service Leeway does not know')

/**
 * A push address to look up or forget, which is never posted to, so any
 * well-formed one will do: a browser on a push service Leeway does not take
 * can still load its settings and turn push off.
 */
export const endpointLookupSchema = z.url().max(1000)

/** Whether a string is an address's origin and nothing more, like https://leeway.example. */
function isOrigin(text: string): boolean {
  try {
    const url = new URL(text)
    return /^https?:$/.test(url.protocol) && url.origin === text
  } catch {
    return false
  }
}

function validKeys(keys: { p256dh: string; auth: string }): boolean {
  try {
    receiverKeyBytes(keys)
    return true
  } catch {
    return false
  }
}

/** A browser's subscription, as PushSubscription.toJSON() gives it, and a name for the device. */
export const subscriptionSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z
      .object({ p256dh: z.string().max(200), auth: z.string().max(100) })
      .refine(validKeys, 'The browser sent keys Leeway cannot use'),
    label: z.string().trim().max(60).optional(),
    /** Where the app was opened: a contact for push services when PUBLIC_URL is not set. */
    origin: z.string().max(200).refine(isOrigin, 'Expected an origin').optional(),
  })
  .strict()

export type SubscriptionInput = z.output<typeof subscriptionSchema>

/** A stored subscription, with what sending needs. */
export interface Subscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  label: string | null
  origin: string | null
  createdAt: Date
  lastSuccessAt: Date | null
}

const COLUMNS = `id, endpoint, p256dh, auth, label, origin, created_at AS "createdAt",
  last_success_at AS "lastSuccessAt"`

/** Saves a subscription; the same browser subscribing again updates its keys. */
export async function saveSubscription(db: Db, input: SubscriptionInput): Promise<void> {
  await db.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, origin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, label = $4, origin = $5`,
    [input.endpoint, input.keys.p256dh, input.keys.auth, input.label || null, input.origin ?? null],
  )
}

export async function listSubscriptions(db: Db): Promise<Subscription[]> {
  const { rows } = await db.query<Subscription>(
    `SELECT ${COLUMNS} FROM push_subscriptions ORDER BY created_at`,
  )
  return rows
}

export async function findSubscription(db: Db, endpoint: string): Promise<Subscription | null> {
  const { rows } = await db.query<Subscription>(
    `SELECT ${COLUMNS} FROM push_subscriptions WHERE endpoint = $1`,
    [endpoint],
  )
  return rows[0] ?? null
}

export async function removeSubscription(db: Db, endpoint: string): Promise<void> {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
}

export async function removeSubscriptionById(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM push_subscriptions WHERE id = $1', [id])
}

export async function recordDelivered(db: Db, id: string, now: Date): Promise<void> {
  await db.query('UPDATE push_subscriptions SET last_success_at = $2 WHERE id = $1', [id, now])
}
