// Bank connections: linking a bank, repairing its login, removing it, and
// acting on the bank's webhooks. Pulling data in is bank sync (sync.ts).

import { BankError, type BankWebhook } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import type { Db } from '../db/pool.js'
import { encrypt } from '../lib/crypto.js'
import { accessTokenOf, bankFailure, requireBank } from './bank.js'
import { recategorize } from './categorize.js'
import { syncConnection, type SyncResult } from './sync.js'

/** One login at one bank, as the owner sees it in Settings. */
export interface Connection {
  id: string
  provider: string
  institutionName: string | null
  status: 'active' | 'needs_reauth' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
  accountCount: number
}

export async function listConnections(db: Db): Promise<Connection[]> {
  const { rows } = await db.query<Connection>(
    `SELECT c.id, c.provider, c.institution_name AS "institutionName", c.status,
       c.last_synced_at AS "lastSyncedAt", c.last_error AS "lastError",
       (SELECT count(*)::int FROM accounts a WHERE a.connection_id = c.id) AS "accountCount"
     FROM connections c ORDER BY c.created_at`,
  )
  return rows
}

/** Where the bank should send webhooks; none without a public address it can reach. */
function webhookUrl(ctx: AppContext): string | null {
  return ctx.config.publicUrl ? `${ctx.config.publicUrl}/api/webhooks/plaid` : null
}

/** A token the browser uses to open the bank login. Pass a connection to repair its login. */
export async function createLinkToken(ctx: AppContext, connectionId?: string): Promise<string> {
  const bank = requireBank(ctx)
  try {
    const token = connectionId ? await accessTokenOf(ctx, connectionId) : undefined
    return await bank.createLinkToken({
      ...(token ? { accessToken: token } : {}),
      webhookUrl: webhookUrl(ctx),
    })
  } catch (error) {
    throw bankFailure(error)
  }
}

/** Saves a newly linked bank and pulls its accounts and history. */
export async function linkBank(ctx: AppContext, publicToken: string): Promise<SyncResult> {
  const bank = requireBank(ctx)
  let item
  try {
    item = await bank.exchangePublicToken(publicToken)
  } catch (error) {
    throw bankFailure(error)
  }
  // Linking the same bank login again replaces its token and keeps its data.
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO connections (provider, provider_item_id, access_token_encrypted, institution_id, institution_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, provider_item_id) DO UPDATE SET
       access_token_encrypted = EXCLUDED.access_token_encrypted, status = 'active', last_error = NULL
     RETURNING id`,
    [
      bank.name,
      item.itemId,
      encrypt(item.accessToken, ctx.config.encryptionKey),
      item.institutionId,
      item.institutionName,
    ],
  )
  return syncConnection(ctx, rows[0]!.id)
}

/** After the owner repairs a login in the bank's window, mark it healthy and catch up. */
export async function reconnected(ctx: AppContext, connectionId: string): Promise<SyncResult> {
  await ctx.db.query(`UPDATE connections SET status = 'active', last_error = NULL WHERE id = $1`, [
    connectionId,
  ])
  return syncConnection(ctx, connectionId)
}

/** Unlinks a bank and deletes its accounts and transactions here. */
export async function removeConnection(ctx: AppContext, connectionId: string): Promise<void> {
  // Tell the bank first so it stops sharing data, but remove locally either way,
  // even when the saved login can no longer be read to tell it.
  const token = await accessTokenOf(ctx, connectionId).catch((error: unknown) => {
    if (error instanceof BankError) return null
    throw error
  })
  if (token) await ctx.bank?.removeItem(token).catch(() => {})
  await ctx.db.query('DELETE FROM connections WHERE id = $1', [connectionId])
  // Payments to a card that is no longer tracked count as spending again.
  await recategorize(ctx.db)
}

/** Acts on a verified bank webhook. Unknown items are ignored. */
export async function handleBankWebhook(
  ctx: AppContext,
  itemId: string,
  event: BankWebhook['event'],
): Promise<void> {
  if (event === 'ignored') return
  const { rows } = await ctx.db.query<{ id: string }>(
    'SELECT id FROM connections WHERE provider_item_id = $1',
    [itemId],
  )
  const connection = rows[0]
  if (!connection) return
  if (event === 'needs_reauth') {
    await ctx.db.query(
      `UPDATE connections SET status = 'needs_reauth', last_error = 'The bank needs you to log in again'
       WHERE id = $1`,
      [connection.id],
    )
    return
  }
  if (event === 'repaired') await reconnected(ctx, connection.id)
  else await syncConnection(ctx, connection.id)
}
