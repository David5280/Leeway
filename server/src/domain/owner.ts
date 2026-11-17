import type { Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password.js'

/** The one person this install belongs to. */
export interface Owner {
  email: string
  name: string | null
  onboarded: boolean
}

const SESSION_DAYS = 30
let dummyHash: Promise<string> | undefined

export async function getOwner(db: Db): Promise<Owner | null> {
  const { rows } = await db.query<Owner>(
    'SELECT email, name, onboarded_at IS NOT NULL AS onboarded FROM owner',
  )
  return rows[0] ?? null
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      'invalid_input',
      `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  }
}

/** Creates the owner account. Only works once, on a fresh install. */
export async function createOwner(
  db: Db,
  input: { email: string; password: string; name?: string | null },
): Promise<Owner> {
  checkPassword(input.password)
  const hash = await hashPassword(input.password)
  const { rows } = await db.query<Owner>(
    `INSERT INTO owner (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING email, name, false AS onboarded`,
    [input.email.trim().toLowerCase(), input.name?.trim() || null, hash],
  )
  if (!rows[0]) throw new AppError('conflict', 'This Leeway already has an owner; sign in instead')
  return rows[0]
}

export async function checkLogin(db: Db, email: string, password: string): Promise<boolean> {
  const { rows } = await db.query<{ email: string; passwordHash: string }>(
    'SELECT email, password_hash AS "passwordHash" FROM owner',
  )
  const owner = rows[0]
  // Always run the slow hash so timing does not reveal whether an owner exists.
  dummyHash ??= hashPassword('no owner yet')
  const valid = await verifyPassword(password, owner?.passwordHash ?? (await dummyHash))
  return Boolean(owner && valid && owner.email === email.trim().toLowerCase())
}

export async function changePassword(
  db: Db,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { rows } = await db.query<{ passwordHash: string }>(
    'SELECT password_hash AS "passwordHash" FROM owner',
  )
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].passwordHash))) {
    throw new AppError('invalid_input', 'Your current password is not right')
  }
  checkPassword(newPassword)
  await db.query('UPDATE owner SET password_hash = $1', [await hashPassword(newPassword)])
  // Sign out every other device.
  await db.query('DELETE FROM sessions')
}

export async function markOnboarded(db: Db): Promise<void> {
  await db.query('UPDATE owner SET onboarded_at = coalesce(onboarded_at, now())')
}

export async function createSession(db: Db): Promise<string> {
  const token = randomToken()
  await db.query(
    `INSERT INTO sessions (token_hash, expires_at) VALUES ($1, now() + make_interval(days => $2))`,
    [hashToken(token), SESSION_DAYS],
  )
  // Clean up expired sessions while we are here.
  await db.query('DELETE FROM sessions WHERE expires_at < now()')
  return token
}

export async function isValidSession(db: Db, token: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [hashToken(token)],
  )
  return Boolean(rowCount)
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
}

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60
