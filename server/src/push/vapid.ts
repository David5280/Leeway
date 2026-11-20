// VAPID (RFC 8292): how Leeway proves to a push service that a message comes
// from the server the browser subscribed to. A signed token per request, from
// a P-256 key pair the server makes for itself.

import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'
import { HOUR_MS } from '../lib/time.js'

/** The server's key pair: the public half as browsers want it, the private half for signing. */
export interface VapidKeys {
  /** The raw public point, base64url: the applicationServerKey a browser subscribes with. */
  publicKey: string
  privateKey: KeyObject
}

/** How long a token is good for. The standard allows up to a day; less limits a leak. */
const TOKEN_LIFETIME_MS = 12 * HOUR_MS

/** A new key pair, with the private half as a JWK so it can be stored encrypted. */
export function generateVapidKeys(): { publicKey: string; privateJwk: JsonWebKey } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateJwk = privateKey.export({ format: 'jwk' })
  return { publicKey: publicKeyFromJwk(privateJwk), privateJwk }
}

/** The keys from a stored private JWK. */
export function vapidKeysFromJwk(privateJwk: JsonWebKey): VapidKeys {
  return {
    publicKey: publicKeyFromJwk(privateJwk),
    privateKey: createPrivateKey({ key: privateJwk, format: 'jwk' }),
  }
}

/** The uncompressed point 0x04 || x || y, base64url, from a P-256 JWK. */
function publicKeyFromJwk(jwk: JsonWebKey): string {
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url')
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/**
 * The Authorization header for one push request. The token names the push
 * service's origin (so it is useless anywhere else), expires, and says who to
 * contact: `subject`, an https address or a mailto.
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: Date,
): string {
  const header = base64UrlJson({ typ: 'JWT', alg: 'ES256' })
  const claims = base64UrlJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor((now.getTime() + TOKEN_LIFETIME_MS) / 1000),
    sub: subject,
  })
  const unsigned = `${header}.${claims}`
  // JWS wants the raw r || s signature, not the DER form node gives by default.
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`
}

/**
 * Where push services may write about problems, which some (Apple's among
 * them) require to be a real address: PUBLIC_URL when it is https, else the
 * https address the device subscribed from, which is where the owner opens
 * Leeway. Push needs https everywhere but a developer's own machine, so the
 * mailto that reaches no one is left only for that.
 */
export function vapidSubject(publicUrl: string | null, deviceOrigin: string | null): string {
  const https = [publicUrl, deviceOrigin].find((url) => url?.startsWith('https://'))
  return https ?? 'mailto:leeway@localhost.invalid'
}
