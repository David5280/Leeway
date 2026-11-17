import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Encrypts secrets (bank access tokens) before they touch the database, with
 * AES-256-GCM. GCM also authenticates the data, so a tampered value fails to
 * decrypt instead of silently producing garbage.
 *
 * Stored format: "v1:<iv>:<auth tag>:<ciphertext>", each part base64. The
 * version prefix leaves room to rotate algorithms later.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  )
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(':')
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted value')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** A random, URL-safe secret, used for session cookies and API tokens. */
export function randomToken(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url')
}

/**
 * Session and API tokens are stored only as a SHA-256 hash. The tokens are
 * long and random, so a fast hash is enough (unlike passwords, which need a
 * slow one because people pick guessable passwords).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
