// Connected apps as the owner sees them in Settings: what each may do, and disconnecting.

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import type { Scope } from './scopes.js'

/** An app the owner approved, like Claude. */
export interface ConnectedApp {
  id: string
  name: string
  host: string
  scope: Scope
  connectedAt: string
  lastUsedAt: string | null
}

export async function listConnectedApps(db: Db): Promise<ConnectedApp[]> {
  const { rows } = await db.query<ConnectedApp>(
    `SELECT id, client_name AS name, client_host AS host, scope,
       created_at AS "connectedAt", last_used_at AS "lastUsedAt"
     FROM oauth_grants ORDER BY created_at`,
  )
  return rows
}

/** Disconnects an app; its tokens stop working at once. */
export async function disconnectApp(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM oauth_grants WHERE id = $1', [id])
  if (!rowCount) throw notFound('Connected app')
}
