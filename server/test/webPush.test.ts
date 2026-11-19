// Web Push on node:crypto: the message encryption against RFC 8291's worked
// example and a browser's own decryption, VAPID tokens a push service would
// accept, and how the sender reads a push service's answer. No request ever
// leaves the test: fetch is a fake.

import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  verify,
  type ECDH,
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { encryptPayload, MAX_PLAINTEXT_BYTES, receiverKeyBytes } from '../src/push/encrypt.js'
import {
  KEYS_REUSED_MS,
  outcomeOf,
  PADDED_BYTES,
  WebPushSender,
  type PushMessage,
} from '../src/push/sender.js'
import {
  generateVapidKeys,
  vapidAuthorization,
  vapidKeysFromJwk,
  vapidSubject,
} from '../src/push/vapid.js'

/** RFC 8291 Appendix A. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  receiverPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWA' +
    'mS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj' +
    '_Qulcy4a-fN',
}

const b64 = (text: string) => Buffer.from(text, 'base64url')

/** 0x04 and 64 bytes: the shape of a P-256 point, but not one on the curve. */
const OFF_CURVE = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url')

function keyPair(privateKey?: string): ECDH {
  const pair = createECDH('prime256v1')
  if (privateKey) pair.setPrivateKey(b64(privateKey))
  else pair.generateKeys()
  return pair
}

/** A browser: its key pair and auth secret, as a subscription carries them. */
function browser() {
  const pair = keyPair()
  const auth = Buffer.alloc(16, 7)
  return {
    pair,
    auth,
    keys: { p256dh: pair.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  }
}

/** Decrypts a body as a browser does, by RFC 8291, to prove the sender's half is right. */
function decryptAsBrowser(body: Buffer, receiver: ECDH, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16)
  const recordSize = body.readUInt32BE(16)
  const idLength = body.readUInt8(20)
  const senderPublic = body.subarray(21, 21 + idLength)
  const sealed = body.subarray(21 + idLength)
  expect(recordSize).toBe(4096)
  const receiverPublic = receiver.getPublicKey()
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic])
  const ikm = hkdfSync('sha256', receiver.computeSecret(senderPublic), auth, info, 32)
  const derive = (label: string, length: number) =>
    Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from(label), length))
  const decipher = createDecipheriv(
    'aes-128-gcm',
    derive('Content-Encoding: aes128gcm\0', 16),
    derive('Content-Encoding: nonce\0', 12),
  )
  decipher.setAuthTag(sealed.subarray(-16))
  const record = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()])
  // The last record ends with 0x02 and then only zero padding.
  const end = record.lastIndexOf(0x02)
  expect(record.subarray(end + 1).every((byte) => byte === 0)).toBe(true)
  return record.subarray(0, end)
}

describe('encryptPayload', () => {
  it("matches RFC 8291's worked example byte for byte", () => {
    const sender = keyPair(RFC.senderPrivate)
    expect(sender.getPublicKey().toString('base64url')).toBe(RFC.senderPublic)
    const body = encryptPayload(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.receiverPublic, auth: RFC.auth },
      { sender, salt: b64(RFC.salt) },
    )
    expect(body.toString('base64url')).toBe(RFC.body)
    // And the RFC's receiver reads it back.
    expect(decryptAsBrowser(body, keyPair(RFC.receiverPrivate), b64(RFC.auth)).toString()).toBe(
      RFC.plaintext,
    )
  })

  it('makes a fresh key and salt for every message, which the browser can read', () => {
    const { pair, auth, keys } = browser()
    const first = encryptPayload(Buffer.from('hello'), keys)
    const second = encryptPayload(Buffer.from('hello'), keys)
    expect(first.subarray(0, 16)).not.toEqual(second.subarray(0, 16))
    expect(first.subarray(21, 86)).not.toEqual(second.subarray(21, 86))
    expect(decryptAsBrowser(first, pair, auth).toString()).toBe('hello')
  })

  it('pads to a fixed size, so messages of different lengths look the same', () => {
    const { pair, auth, keys } = browser()
    const short = encryptPayload(Buffer.from('a'), keys, { padTo: 256 })
    const long = encryptPayload(Buffer.from('a'.repeat(200)), keys, { padTo: 256 })
    expect(short.length).toBe(long.length)
    expect(decryptAsBrowser(short, pair, auth).toString()).toBe('a')
    // A message longer than the padding is sent whole.
    const longer = encryptPayload(Buffer.from('b'.repeat(300)), keys, { padTo: 256 })
    expect(decryptAsBrowser(longer, pair, auth).toString()).toBe('b'.repeat(300))
  })

  it('refuses a message too long for one record', () => {
    const { keys } = browser()
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES), keys)).not.toThrow()
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES + 1), keys)).toThrow(
      /at most 3993 bytes/,
    )
    expect(() =>
      encryptPayload(Buffer.from('x'), keys, { padTo: MAX_PLAINTEXT_BYTES + 1 }),
    ).toThrow(/at most/)
  })

  it('refuses keys that are not what the standard sets, before any math', () => {
    const { keys } = browser()
    const compressed = b64(keys.p256dh)
    compressed[0] = 0x02
    expect(() => receiverKeyBytes({ ...keys, p256dh: compressed.toString('base64url') })).toThrow(
      /uncompressed P-256/,
    )
    expect(() => receiverKeyBytes({ ...keys, p256dh: 'BAAA' })).toThrow(/uncompressed/)
    expect(() => receiverKeyBytes({ ...keys, auth: 'c2hvcnQ' })).toThrow(/16 bytes/)
  })

  it('refuses a key of the right shape that is not a point on the curve', () => {
    const { keys } = browser()
    expect(() => receiverKeyBytes({ ...keys, p256dh: OFF_CURVE })).toThrow(/P-256 point/)
    expect(() => encryptPayload(Buffer.from('x'), { ...keys, p256dh: OFF_CURVE })).toThrow()
  })
})

describe('VAPID', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'
  const NOW = new Date('2026-11-17T18:00:00Z')

  function parse(header: string) {
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    const [, head, claims, signature, key] = match
    return {
      head: JSON.parse(b64(head!).toString()),
      claims: JSON.parse(b64(claims!).toString()),
      signed: Buffer.from(`${head}.${claims}`),
      signature: b64(signature!),
      key: key!,
    }
  }

  it("signs a token for the push service's origin that its public key verifies", () => {
    const { privateJwk } = generateVapidKeys()
    const keys = vapidKeysFromJwk(privateJwk)
    const token = parse(vapidAuthorization(ENDPOINT, keys, 'https://leeway.example', NOW))
    expect(token.head).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(token.claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: NOW.getTime() / 1000 + 12 * 3600,
      sub: 'https://leeway.example',
    })
    expect(token.key).toBe(keys.publicKey)
    // The raw public point, as a browser's applicationServerKey takes it.
    const point = b64(token.key)
    expect(point).toHaveLength(65)
    expect(point[0]).toBe(0x04)
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })
    // JWS signatures are raw r || s, 64 bytes.
    expect(token.signature).toHaveLength(64)
    expect(
      verify(
        'sha256',
        token.signed,
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        token.signature,
      ),
    ).toBe(true)
  })

  it('gives the same public key back from the stored private key', () => {
    const { publicKey, privateJwk } = generateVapidKeys()
    expect(vapidKeysFromJwk(privateJwk).publicKey).toBe(publicKey)
  })

  it('names PUBLIC_URL, else the https address the device subscribed from, as a contact', () => {
    const device = 'https://leeway.home.example'
    expect(vapidSubject('https://leeway.example', device)).toBe('https://leeway.example')
    expect(vapidSubject(null, device)).toBe(device)
    expect(vapidSubject('http://192.168.1.5:3000', device)).toBe(device)
    // Push needs https except on a developer's own machine, where no one is contacted.
    expect(vapidSubject('http://localhost:3000', 'http://localhost:3000')).toBe(
      'mailto:leeway@localhost.invalid',
    )
    expect(vapidSubject(null, null)).toBe('mailto:leeway@localhost.invalid')
  })
})

describe('WebPushSender', () => {
  const MESSAGE: PushMessage = {
    title: 'Overdrawn',
    body: 'Everyday is below zero.',
    url: '/alerts',
    tag: 'leeway-overdrawn',
  }
  const keys = vapidKeysFromJwk(generateVapidKeys().privateJwk)

  function senderAnswering(answer: number | Error) {
    const requests: { url: string; init: RequestInit }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      if (answer instanceof Error) throw answer
      return new Response(null, { status: answer })
    }) as unknown as typeof fetch
    const sender = new WebPushSender({
      keys: async () => keys,
      publicUrl: 'https://leeway.example',
      fetch: fakeFetch,
      now: () => new Date('2026-11-17T18:00:00Z'),
    })
    return { sender, requests }
  }

  it('posts the message encrypted, padded and signed, with headers push services want', async () => {
    const device = browser()
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      ...device.keys,
      origin: null,
    }
    const { sender, requests } = senderAnswering(201)
    expect(await sender.send(target, MESSAGE)).toBe('sent')
    const [{ url, init }] = requests as [(typeof requests)[number]]
    expect(url).toBe(target.endpoint)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    const headers = init.headers as Record<string, string>
    expect(headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
      Topic: 'leeway',
    })
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/)
    const body = Buffer.from(init.body as Uint8Array)
    // Every push is the same size on the wire, whatever it says.
    expect(body.length).toBe(86 + PADDED_BYTES + 1 + 16)
    const plain = decryptAsBrowser(body, device.pair, device.auth)
    expect(JSON.parse(plain.toString())).toEqual(MESSAGE)
  })

  it.each([
    [200, 'sent'],
    [201, 'sent'],
    [404, 'gone'],
    [410, 'gone'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'rejected'],
  ] as const)('reads %i as %s', async (status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome)
    const { sender } = senderAnswering(status)
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      ...browser().keys,
      origin: null,
    }
    expect(await sender.send(target, MESSAGE)).toBe(outcome)
  })

  it('tries again later when the push service cannot be reached', async () => {
    const { sender } = senderAnswering(new TypeError('fetch failed'))
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      ...browser().keys,
      origin: null,
    }
    expect(await sender.send(target, MESSAGE)).toBe('retry')
  })

  it("refuses a device whose key can't be used, without asking the push service", async () => {
    const { sender, requests } = senderAnswering(201)
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      ...browser().keys,
      p256dh: OFF_CURVE,
      origin: null,
    }
    expect(await sender.send(target, MESSAGE)).toBe('rejected')
    expect(requests).toEqual([])
  })

  it("tries again later when the server's own keys can't be loaded, then loads them afresh", async () => {
    const load = vi.fn<() => Promise<typeof keys>>()
    load.mockRejectedValueOnce(new Error('database down')).mockResolvedValue(keys)
    const fakeFetch = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch
    const sender = new WebPushSender({ keys: load, publicUrl: null, fetch: fakeFetch })
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      ...browser().keys,
      origin: null,
    }
    expect(await sender.send(target, MESSAGE)).toBe('retry')
    expect(await sender.send(target, MESSAGE)).toBe('sent')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads the keys once for a push to every device, and again after a minute', async () => {
    let now = new Date('2026-11-17T18:00:00Z')
    const load = vi.fn(async () => keys)
    const fakeFetch = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch
    const sender = new WebPushSender({
      keys: load,
      publicUrl: null,
      fetch: fakeFetch,
      now: () => now,
    })
    const devices = [browser(), browser(), browser()].map((device, index) => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${index}`,
      ...device.keys,
      origin: null,
    }))
    await Promise.all(devices.map((device) => sender.send(device, MESSAGE)))
    expect(load).toHaveBeenCalledTimes(1)
    now = new Date(now.getTime() + KEYS_REUSED_MS)
    await sender.send(devices[0]!, MESSAGE)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("signs with the device's own https address as the contact when PUBLIC_URL is not set", async () => {
    const requests: RequestInit[] = []
    const fakeFetch = (async (_: string, init: RequestInit) => {
      requests.push(init)
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch
    const sender = new WebPushSender({ keys: async () => keys, publicUrl: null, fetch: fakeFetch })
    const target = {
      endpoint: 'https://web.push.apple.com/abc',
      ...browser().keys,
      origin: 'https://leeway.home.example',
    }
    await sender.send(target, MESSAGE)
    const header = (requests[0]!.headers as Record<string, string>).Authorization!
    const token = /^vapid t=([^,]+),/.exec(header)![1]!
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    expect(claims.sub).toBe('https://leeway.home.example')
  })

  it('uses the global fetch and the real clock when given none', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return new Response(null, { status: 201 })
    })
    try {
      const sender = new WebPushSender({ keys: async () => keys, publicUrl: null })
      const target = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
        ...browser().keys,
        origin: null,
      }
      expect(await sender.send(target, MESSAGE)).toBe('sent')
      expect(calls).toEqual([target.endpoint])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
