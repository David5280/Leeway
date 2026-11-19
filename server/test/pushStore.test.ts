// The server's VAPID keys (made once, stored encrypted) and the devices that
// turned push on (only real push services, removed when they expire).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { keysReplacedLine, loadVapidKeys } from '../src/push/keys.js'
import {
  findSubscription,
  isPushEndpoint,
  listSubscriptions,
  recordDelivered,
  removeSubscription,
  saveSubscription,
  subscriptionSchema,
} from '../src/push/subscriptions.js'
import { createTestContext, resetData } from './helpers.js'
import { deviceKeys, subscriptionFor } from './fixtures/push.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('VAPID keys', () => {
  it('makes a key pair on first use and gives the same one after', async () => {
    const first = await loadVapidKeys(ctx.db, ctx.config.encryptionKey)
    const again = await loadVapidKeys(ctx.db, ctx.config.encryptionKey)
    expect(again.publicKey).toBe(first.publicKey)
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM push_keys')
    expect(rows[0].n).toBe(1)
  })

  it('stores the private key encrypted, never as it is', async () => {
    const keys = await loadVapidKeys(ctx.db, ctx.config.encryptionKey)
    const { d } = keys.privateKey.export({ format: 'jwk' })
    const { rows } = await ctx.db.query('SELECT public_key, private_key_encrypted FROM push_keys')
    expect(rows[0].public_key).toBe(keys.publicKey)
    expect(rows[0].private_key_encrypted).toMatch(/^v1:/)
    expect(rows[0].private_key_encrypted).not.toContain(d)
    expect(JSON.stringify(rows)).not.toMatch(/"d"/)
  })

  it('keeps one key pair when two servers start at once', async () => {
    const [a, b] = await Promise.all([
      loadVapidKeys(ctx.db, ctx.config.encryptionKey),
      loadVapidKeys(ctx.db, ctx.config.encryptionKey),
    ])
    expect(a.publicKey).toBe(b.publicKey)
  })

  it('starts over when ENCRYPTION_KEY changed, removing devices tied to the old key', async () => {
    const old = await loadVapidKeys(ctx.db, ctx.config.encryptionKey)
    await saveSubscription(ctx.db, subscriptionFor('https://fcm.googleapis.com/fcm/send/a'))
    await saveSubscription(ctx.db, subscriptionFor('https://fcm.googleapis.com/fcm/send/b'))
    const otherKey = Buffer.alloc(32, 9)
    const told: number[] = []
    const fresh = await loadVapidKeys(ctx.db, otherKey, (removed) => told.push(removed))
    expect(fresh.publicKey).not.toBe(old.publicKey)
    expect(await listSubscriptions(ctx.db)).toEqual([])
    expect(told).toEqual([2])
    // And the new pair is the one kept.
    expect((await loadVapidKeys(ctx.db, otherKey)).publicKey).toBe(fresh.publicKey)
  })
})

describe('the log line for a new key pair', () => {
  it('counts the devices, and holds no key material', () => {
    expect(keysReplacedLine(1)).toBe(
      'ENCRYPTION_KEY changed, so push has a new key pair. Push was turned off on 1 device; turn it on again on each.',
    )
    expect(keysReplacedLine(3)).toMatch(/on 3 devices;/)
  })
})

describe('push endpoints', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QK4abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('accepts a real push service: %s', (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x',
    'https://localhost/push',
    'https://127.0.0.1/push',
    'https://push.apple.com.example/x',
    'not a url',
  ])('refuses anything else, so the server never posts inside its own network: %s', (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(false)
  })

  it('refuses keys a browser could not have made', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
    expect(subscriptionSchema.safeParse(subscriptionFor(endpoint)).success).toBe(true)
    const bad = { endpoint, keys: { ...deviceKeys(), auth: 'short' } }
    expect(subscriptionSchema.safeParse(bad).error?.issues[0]?.message).toBe(
      'The browser sent keys Leeway cannot use',
    )
    expect(
      subscriptionSchema.safeParse({ endpoint: 'https://localhost/x', keys: deviceKeys() }).error
        ?.issues[0]?.message,
    ).toBe('This browser uses a push service Leeway does not know')
  })

  it('refuses a key of the right shape that is not a point on the curve', () => {
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url')
    const keys = { ...deviceKeys(), p256dh: offCurve }
    const parsed = subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys })
    expect(parsed.error?.issues[0]?.message).toBe('The browser sent keys Leeway cannot use')
  })

  it('takes the address the app was opened at, as an origin only', () => {
    const base = subscriptionFor('https://fcm.googleapis.com/fcm/send/abc')
    for (const origin of ['https://leeway.example', 'http://localhost:5173']) {
      expect(subscriptionSchema.safeParse({ ...base, origin }).success).toBe(true)
    }
    for (const origin of ['https://leeway.example/inbox', 'ftp://leeway.example', 'nonsense']) {
      expect(subscriptionSchema.safeParse({ ...base, origin }).success).toBe(false)
    }
  })
})

describe('subscriptions', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1'

  it('saves a device once, updating its keys and name when it subscribes again', async () => {
    await saveSubscription(ctx.db, {
      ...subscriptionFor(ENDPOINT),
      label: 'Phone',
      origin: 'https://leeway.example',
    })
    expect((await findSubscription(ctx.db, ENDPOINT))?.origin).toBe('https://leeway.example')
    const renewed = { ...subscriptionFor(ENDPOINT), label: '' }
    await saveSubscription(ctx.db, renewed)
    const devices = await listSubscriptions(ctx.db)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      endpoint: ENDPOINT,
      p256dh: renewed.keys.p256dh,
      label: null,
      origin: null,
      lastSuccessAt: null,
    })
  })

  it('finds, records deliveries to, and removes a device', async () => {
    await saveSubscription(ctx.db, subscriptionFor(ENDPOINT))
    const device = (await findSubscription(ctx.db, ENDPOINT))!
    await recordDelivered(ctx.db, device.id, ctx.now())
    expect((await findSubscription(ctx.db, ENDPOINT))?.lastSuccessAt).toEqual(ctx.now())
    await removeSubscription(ctx.db, ENDPOINT)
    expect(await findSubscription(ctx.db, ENDPOINT)).toBeNull()
  })
})
