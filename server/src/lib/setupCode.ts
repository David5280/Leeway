// The one-time code that proves whoever creates the owner account runs this server.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const GROUPS = 3
const GROUP_LENGTH = 4

/**
 * A fresh code like "K7QM-2XRA-9PVD": twelve characters from 31, about 59
 * bits, far beyond guessing at a few tries a minute. Leeway prints it in the
 * server log at startup until the owner account exists.
 */
export function generateSetupCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  )
  return groups.join('-')
}

/** Spaces, dashes and case do not matter, so a code typed from a log still counts. */
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** Whether a typed code is the setup code, compared in constant time. */
export function setupCodeMatches(typed: string, expected: string): boolean {
  // Hashing first gives both sides one length, so the comparison leaks nothing.
  const digest = (code: string) => createHash('sha256').update(normalize(code)).digest()
  return timingSafeEqual(digest(typed), digest(expected))
}
