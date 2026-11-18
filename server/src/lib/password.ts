// Password hashing with scrypt, compared in constant time.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

// scrypt is deliberately slow and memory hungry, which makes guessing
// passwords from a leaked hash expensive. These are OWASP's minimum for
// scrypt in the form that keeps memory at 32 MiB per check (N=2^15, r=8,
// p=3), so a burst of sign-ins cannot exhaust a small server's memory. A
// check takes ~150 ms.
const PARAMS = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const KEY_LENGTH = 64

/** Stored format: "scrypt:<N>:<r>:<p>:<salt>:<hash>" so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(':')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split(':')
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  })
  // Constant-time comparison so response timing reveals nothing about the hash.
  return timingSafeEqual(actual, expected)
}

/**
 * Whether a stored hash was made with weaker settings than today's, so the
 * next successful sign-in should store it again with the current ones.
 */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split(':')
  return Number(n) < PARAMS.N || Number(r) < PARAMS.r || Number(p) < PARAMS.p
}
