// Bank connections: linking a bank, repairing its login, removing it, and
// acting on the bank's webhooks. Pulling data in is bank sync (sync.ts).

import { BankError, type BankWebhook } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import type { Db } from '../db/pool.js'
import { encrypt } from '../lib/crypto.js'
import { accessTokenOf, bankFailure, requireBank } from './bank.js'
import { recategorize } from './categorize.js'
import {
  duplicateBankError,
  loginsAtBank,
  type PickedAccount,
  type PickedBank,
} from './sameBank.js'
import { syncConnection, type SyncResult } from './sync.js'

/** One login at one bank, as the owner sees it in Settings. */
export interface Connection {
  id: string
  provider: string
  institutionName: string | null
  status: 'active' | 'needs_reauth' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
  /** The accounts the bank shares from this login. */
  accountCount: number
  /** Accounts kept from this login that the bank no longer shares (unshared.ts). */
  unsharedCount: number
}

export async function listConnections(db: Db): Promise<Connection[]> {
  const { rows } = await db.query<Connection>(
    `SELECT c.id, c.provider, c.institution_name AS "institutionName", c.status,
       c.last_synced_at AS "lastSyncedAt", c.last_error AS "lastError",
       (SELECT count(*)::int FROM accounts a
        WHERE a.connection_id = c.id AND a.unshared_at IS NULL) AS "accountCount",
       (SELECT count(*)::int FROM accounts a
        WHERE a.connection_id = c.id AND a.unshared_at IS NOT NULL) AS "unsharedCount"
     FROM connections c ORDER BY c.created_at`,
  )
  return rows
}

/** Where the bank should send webhooks; none without a public address it can reach. */
function webhookUrl(ctx: AppContext): string | null {
  return ctx.config.publicUrl ? `${ctx.config.publicUrl}/api/webhooks/plaid` : null
}

/**
 * A token the browser uses to open the bank login. Pass a connection to open
 * it for that login instead (Plaid's update mode), which repairs it without a
 * new Item; `chooseAccounts` also lets the owner share accounts they left out.
 */
export async function createLinkToken(
  ctx: AppContext,
  connectionId?: string,
  options: { chooseAccounts?: boolean } = {},
): Promise<string> {
  const bank = requireBank(ctx)
  try {
    const token = connectionId ? await accessTokenOf(ctx, connectionId) : undefined
    return await bank.createLinkToken({
      ...(token ? { accessToken: token, chooseAccounts: options.chooseAccounts ?? false } : {}),
      webhookUrl: webhookUrl(ctx),
    })
  } catch (error) {
    throw bankFailure(error)
  }
}

/** A bank picked in the login window, as the window reported it when it closed. */
export interface NewLink {
  publicToken: string
  /** The bank the window says was picked; null when it did not say. */
  institution: PickedBank | null
  /** The accounts the owner picked in the window. */
  accounts: PickedAccount[]
  /** The owner confirmed this is a second, separate login at a bank already connected. */
  allowSecondLogin: boolean
}

export interface LinkResult extends SyncResult {
  /**
   * An older connection at the same bank, when the window did not say which
   * bank it was and the duplicate showed only after Plaid had counted it.
   */
  possibleDuplicateOf: string | null
}

/**
 * Saves a newly linked bank and pulls its accounts and history.
 *
 * A bank that is already connected is refused before the public token is
 * exchanged, since the exchange is when Plaid counts a new Item, unless the
 * owner confirmed a second login there. If the window did not say which bank
 * it was, the check runs again on what Plaid says after the exchange. By then
 * the Item is counted, removing it would not give its place back on the Trial
 * plan, and at some banks (Chase among them) a new login cuts off the old one,
 * so the new connection is kept and flagged for the owner to decide.
 */
export async function linkBank(ctx: AppContext, link: NewLink): Promise<LinkResult> {
  const bank = requireBank(ctx)
  if (link.institution && !link.allowSecondLogin) {
    const logins = await loginsAtBank(ctx.db, link.institution.id, link.accounts)
    if (logins.length > 0) throw duplicateBankError(link.institution, logins)
  }

  let item
  try {
    item = await bank.exchangePublicToken(link.publicToken)
  } catch (error) {
    throw bankFailure(error)
  }
  // The second look, at the bank Plaid itself names; the login just saved is not its own duplicate.
  const missed = link.allowSecondLogin
    ? []
    : await loginsAtBank(ctx.db, item.institutionId, link.accounts, item.itemId)

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
  const result = synced(ctx, await syncConnection(ctx, rows[0]!.id))
  return { ...result, possibleDuplicateOf: missed[0]?.connectionId ?? null }
}

/** A sync's result, after telling whoever listens that bank data changed. */
function synced(ctx: AppContext, result: SyncResult): SyncResult {
  ctx.afterBankUpdate?.()
  return result
}

/** After the owner repairs a login in the bank's window, mark it healthy and catch up. */
export async function reconnected(ctx: AppContext, connectionId: string): Promise<SyncResult> {
  await ctx.db.query(`UPDATE connections SET status = 'active', last_error = NULL WHERE id = $1`, [
    connectionId,
  ])
  return synced(ctx, await syncConnection(ctx, connectionId))
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
    ctx.afterBankUpdate?.()
    return
  }
  if (event === 'repaired') await reconnected(ctx, connection.id)
  else synced(ctx, await syncConnection(ctx, connection.id))
}
