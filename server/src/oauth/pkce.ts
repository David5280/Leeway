// Proof Key for Code Exchange (RFC 7636): how a public app proves the code is its own.

import { createHash, timingSafeEqual } from 'node:crypto'

/** A base64url SHA-256 digest, 43 characters: the only challenge S256 can produce. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** A code verifier: 43 to 128 unreserved characters (RFC 7636 section 4.1). */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

export function isValidChallenge(challenge: string): boolean {
  return S256_CHALLENGE.test(challenge)
}

/** Whether the verifier hashes to the challenge sent when sign-in started. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER.test(verifier)) return false
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
