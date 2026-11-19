// Web Push message encryption (RFC 8291, "aes128gcm" from RFC 8188), built on
// node:crypto so no third-party code sits between Leeway and the owner's
// alerts. The push service carries the bytes but cannot read them.

import { createCipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from 'node:crypto'

/** A browser's keys for a subscription, base64url as the Push API gives them. */
export interface ReceiverKeys {
  p256dh: string
  auth: string
}

/** One record holds the whole message; push services accept at most 4096 bytes. */
const RECORD_SIZE = 4096
const SALT_BYTES = 16
const TAG_BYTES = 16
const PUBLIC_KEY_BYTES = 65
const HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES
/** The plaintext room in one record, after the delimiter and the tag. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1

/** Options a test uses to repeat the RFC's worked example; real sends leave them out. */
export interface EncryptOptions {
  /** The sender's one-time key pair; a fresh one by default. */
  sender?: ECDH
  salt?: Buffer
  /**
   * Pads the plaintext to at least this many bytes, so the push service
   * cannot guess what an alert says from its length. 0 adds no padding.
   */
  padTo?: number
}

export function fromBase64Url(text: string): Buffer {
  return Buffer.from(text, 'base64url')
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}

/** Checks a browser's keys are the sizes the standard sets, before any math with them. */
export function receiverKeyBytes(keys: ReceiverKeys): { publicKey: Buffer; auth: Buffer } {
  const publicKey = fromBase64Url(keys.p256dh)
  const auth = fromBase64Url(keys.auth)
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 0x04) {
    throw new Error('The browser key must be an uncompressed P-256 point')
  }
  if (auth.length !== 16) throw new Error('The browser auth secret must be 16 bytes')
  return { publicKey, auth }
}

/**
 * Encrypts `plaintext` for one browser. The result is the request body: a
 * header (salt, record size, the sender's public key) and one sealed record.
 */
export function encryptPayload(
  plaintext: Buffer,
  keys: ReceiverKeys,
  options: EncryptOptions = {},
): Buffer {
  const { publicKey: receiverPublic, auth } = receiverKeyBytes(keys)
  const padTo = options.padTo ?? 0
  if (plaintext.length > MAX_PLAINTEXT_BYTES || padTo > MAX_PLAINTEXT_BYTES) {
    throw new Error(`A push message holds at most ${MAX_PLAINTEXT_BYTES} bytes`)
  }
  const sender = options.sender ?? newSenderKeys()
  const salt = options.salt ?? randomBytes(SALT_BYTES)
  const senderPublic = sender.getPublicKey()

  // RFC 8291 section 3.4: mix the shared secret with the browser's auth secret,
  // then derive the content key and nonce from that and the salt.
  const shared = sender.computeSecret(receiverPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic])
  const ikm = hkdf(shared, auth, keyInfo, 32)
  const contentKey = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)

  // The last (and only) record ends with 0x02, then any zero padding.
  const padding = Buffer.alloc(Math.max(0, padTo - plaintext.length))
  const record = Buffer.concat([plaintext, Buffer.from([0x02]), padding])
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce)
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()])

  const header = Buffer.alloc(HEADER_BYTES)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES)
  header.writeUInt8(PUBLIC_KEY_BYTES, SALT_BYTES + 4)
  senderPublic.copy(header, SALT_BYTES + 5)
  return Buffer.concat([header, sealed])
}

function newSenderKeys(): ECDH {
  const sender = createECDH('prime256v1')
  sender.generateKeys()
  return sender
}
