// The token the home-screen widget reads its summary with. It is kept apart
// from agent keys (tokens.ts) and only ever opens GET /api/widget. There is
// at most one: making a new one replaces the old, which stops working.

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import { hashToken, randomToken } from '../lib/crypto.js'

/** Widget tokens start with this, so one is never mistaken for an agent key (lw_). */
export const WIDGET_TOKEN_PREFIX = 'lww_'

/** What the app shows about the token: never the token itself. */
export interface WidgetToken {
  /** Always "Widget": there is one token, for every device the widget runs on. */
  name: 'Widget'
  createdAt: string
  lastUsedAt: string | null
}

const COLUMNS = `'Widget' AS name, created_at AS "createdAt", last_used_at AS "lastUsedAt"`

/** The token in use, or null when the owner has not made one. */
export async function getWidgetToken(db: Db): Promise<WidgetToken | null> {
  const { rows } = await db.query<WidgetToken>(`SELECT ${COLUMNS} FROM widget_tokens`)
  return rows[0] ?? null
}

/**
 * Makes a new token, writing over any earlier one. The table holds one row at
 * most, so even two makes at once leave a single token. The plain token is
 * returned once and never stored, only its hash.
 */
export async function createWidgetToken(db: Db): Promise<WidgetToken & { token: string }> {
  const token = randomToken(WIDGET_TOKEN_PREFIX)
  const { rows } = await db.query<WidgetToken>(
    `INSERT INTO widget_tokens (token_hash) VALUES ($1)
     ON CONFLICT (id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, created_at = now(), last_used_at = NULL
     RETURNING ${COLUMNS}`,
    [hashToken(token)],
  )
  return { ...rows[0]!, token }
}

/** Revokes the token: every widget using it stops updating at once. */
export async function revokeWidgetToken(db: Db): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM widget_tokens')
  if (!rowCount) throw notFound('Widget token')
}

/** Whether `token` is the widget's token, noting when it was last used. */
export async function verifyWidgetToken(db: Db, token: string): Promise<boolean> {
  // Anything else (an agent key, an OAuth token) is refused without a lookup.
  if (!token.startsWith(WIDGET_TOKEN_PREFIX)) return false
  const { rowCount } = await db.query(
    'UPDATE widget_tokens SET last_used_at = now() WHERE token_hash = $1',
    [hashToken(token)],
  )
  return rowCount === 1
}
