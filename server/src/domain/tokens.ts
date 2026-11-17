// Tokens that let an AI agent connect over MCP, stored only as hashes.

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import { hashToken, randomToken } from '../lib/crypto.js'

/** An access token for an AI agent connecting over MCP. */
export interface ApiToken {
  id: string
  name: string
  scope: 'read' | 'write'
  createdAt: string
  lastUsedAt: string | null
}

const COLUMNS = `id, name, scope, created_at AS "createdAt", last_used_at AS "lastUsedAt"`

export async function listTokens(db: Db): Promise<ApiToken[]> {
  const { rows } = await db.query<ApiToken>(`SELECT ${COLUMNS} FROM api_tokens ORDER BY created_at`)
  return rows
}

/** The plain token is returned once and never stored, only its hash. */
export async function createToken(
  db: Db,
  name: string,
  scope: 'read' | 'write',
): Promise<ApiToken & { token: string }> {
  const token = randomToken('lw_')
  const { rows } = await db.query<ApiToken>(
    `INSERT INTO api_tokens (name, scope, token_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [name, scope, hashToken(token)],
  )
  return { ...rows[0]!, token }
}

export async function deleteToken(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM api_tokens WHERE id = $1', [id])
  if (!rowCount) throw notFound('Token')
}

/** Returns the token's scope, or null if the token is unknown. */
export async function verifyToken(db: Db, token: string): Promise<'read' | 'write' | null> {
  const { rows } = await db.query<{ scope: 'read' | 'write' }>(
    'UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING scope',
    [hashToken(token)],
  )
  return rows[0]?.scope ?? null
}
