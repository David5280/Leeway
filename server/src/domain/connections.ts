// Bank connections: linking, syncing transactions in, and handling expired logins.

import type pg from 'pg'
import type { BankAccount, BankProvider, BankTransaction } from '../bank/provider.js'
import { BankError } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import { withTransaction, type Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { loadOwnAccounts, recategorize } from './categorize.js'
import { sameOwnAccounts } from './transfers.js'

export interface Connection {
  id: string
  provider: string
  institutionName: string | null
  status: 'active' | 'needs_reauth' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
  accountCount: number
}

export interface SyncResult {
  connectionId: string
  institutionName: string | null
  added: number
  modified: number
  removed: number
  error: string | null
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

export function requireBank(ctx: AppContext): BankProvider {
  if (!ctx.bank) {
    throw new AppError(
      'not_configured',
      'Bank sync is not set up yet. Add PLAID_CLIENT_ID and PLAID_SECRET to this server and restart it.',
    )
  }
  return ctx.bank
}

async function accessToken(ctx: AppContext, connectionId: string): Promise<string> {
  const { rows } = await ctx.db.query<{ token: string }>(
    'SELECT access_token_encrypted AS token FROM connections WHERE id = $1',
    [connectionId],
  )
  if (!rows[0]) throw notFound('Connection')
  return decrypt(rows[0].token, ctx.config.encryptionKey)
}

function webhookUrl(ctx: AppContext): string | null {
  return ctx.config.publicUrl ? `${ctx.config.publicUrl}/api/webhooks/plaid` : null
}

/** A token the browser uses to open the bank login. Pass a connection to repair its login. */
export async function createLinkToken(ctx: AppContext, connectionId?: string): Promise<string> {
  const bank = requireBank(ctx)
  const token = connectionId ? await accessToken(ctx, connectionId) : undefined
  try {
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

export async function removeConnection(ctx: AppContext, connectionId: string): Promise<void> {
  const token = await accessToken(ctx, connectionId)
  // Tell the bank first so it stops sharing data, but remove locally either way.
  await ctx.bank?.removeItem(token).catch(() => {})
  await ctx.db.query('DELETE FROM connections WHERE id = $1', [connectionId])
  // Payments to a card that is no longer tracked count as spending again.
  await recategorize(ctx.db)
}

function bankFailure(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('bank_error', (error as Error).message)
}

/**
 * Pulls everything that changed at the bank since the last sync. All pages
 * are fetched before anything is written, then applied in one database
 * transaction with the new cursor, so a failure halfway leaves no partial
 * state and the next sync simply retries from the old cursor.
 */
export async function syncConnection(ctx: AppContext, connectionId: string): Promise<SyncResult> {
  const bank = requireBank(ctx)
  const { rows } = await ctx.db.query<{ cursor: string | null; institutionName: string | null }>(
    'SELECT sync_cursor AS cursor, institution_name AS "institutionName" FROM connections WHERE id = $1',
    [connectionId],
  )
  if (!rows[0]) throw notFound('Connection')
  const { institutionName } = rows[0]
  const token = await accessToken(ctx, connectionId)

  try {
    const accounts = await bank.getAccounts(token)
    const added: BankTransaction[] = []
    const modified: BankTransaction[] = []
    const removed: string[] = []
    let cursor = rows[0].cursor
    for (let page = 0; page < 200; page++) {
      const result = await bank.syncTransactions(token, cursor)
      added.push(...result.added)
      modified.push(...result.modified)
      removed.push(...result.removed)
      cursor = result.nextCursor
      if (!result.hasMore) break
    }

    await withTransaction(ctx.db, async (db) => {
      const cardsBefore = await loadOwnAccounts(db)
      const accountIds = await upsertAccounts(db, connectionId, accounts)
      const touched = await applyTransactions(db, accountIds, added, modified, removed)
      // A newly tracked card turns earlier payments to it into transfers, so
      // when the cards change every transaction is looked at again.
      const cardsChanged = !sameOwnAccounts(cardsBefore, await loadOwnAccounts(db))
      await recategorize(db, cardsChanged ? undefined : touched)
      await db.query(
        `UPDATE connections SET sync_cursor = $2, last_synced_at = now(), status = 'active', last_error = NULL
         WHERE id = $1`,
        [connectionId, cursor],
      )
    })
    return {
      connectionId,
      institutionName,
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      error: null,
    }
  } catch (error) {
    const message = (error as Error).message
    const status = error instanceof BankError && error.needsReauth ? 'needs_reauth' : 'error'
    await ctx.db.query('UPDATE connections SET status = $2, last_error = $3 WHERE id = $1', [
      connectionId,
      status,
      message,
    ])
    if (!(error instanceof BankError)) throw error
    return { connectionId, institutionName, added: 0, modified: 0, removed: 0, error: message }
  }
}

/** Syncs every connection, one at a time; one broken bank does not stop the others. */
export async function syncAll(ctx: AppContext): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  for (const connection of await listConnections(ctx.db)) {
    results.push(await syncConnection(ctx, connection.id))
  }
  return results
}

async function upsertAccounts(
  db: pg.PoolClient,
  connectionId: string,
  accounts: BankAccount[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const a of accounts) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO accounts (connection_id, provider_account_id, name, official_name, mask, type, subtype,
         balance_cents, available_cents, credit_limit_cents, currency, balance_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (connection_id, provider_account_id) DO UPDATE SET
         name = EXCLUDED.name, official_name = EXCLUDED.official_name, mask = EXCLUDED.mask,
         type = EXCLUDED.type, subtype = EXCLUDED.subtype, balance_cents = EXCLUDED.balance_cents,
         available_cents = EXCLUDED.available_cents, credit_limit_cents = EXCLUDED.credit_limit_cents,
         currency = EXCLUDED.currency, balance_updated_at = now()
       RETURNING id`,
      [
        connectionId,
        a.providerAccountId,
        a.name,
        a.officialName,
        a.mask,
        a.type,
        a.subtype,
        a.balanceCents,
        a.availableCents,
        a.creditLimitCents,
        a.currency,
      ],
    )
    ids.set(a.providerAccountId, rows[0]!.id)
  }
  return ids
}

/** Applies a sync's changes; returns the ids of transactions added or changed. */
async function applyTransactions(
  db: pg.PoolClient,
  accountIds: Map<string, string>,
  added: BankTransaction[],
  modified: BankTransaction[],
  removed: string[],
): Promise<string[]> {
  const touched: string[] = []
  for (const tx of [...added, ...modified]) {
    const accountId = accountIds.get(tx.providerAccountId)
    if (!accountId) continue // an account the bank no longer reports
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO transactions (account_id, provider_transaction_id, pending_provider_transaction_id,
         date, name, merchant_name, amount_cents, currency, pending,
         provider_category_primary, provider_category_detailed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (account_id, provider_transaction_id) DO UPDATE SET
         pending_provider_transaction_id = EXCLUDED.pending_provider_transaction_id,
         date = EXCLUDED.date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name,
         amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency, pending = EXCLUDED.pending,
         provider_category_primary = EXCLUDED.provider_category_primary,
         provider_category_detailed = EXCLUDED.provider_category_detailed,
         updated_at = now()
       RETURNING id`,
      [
        accountId,
        tx.providerTransactionId,
        tx.pendingProviderTransactionId,
        tx.date,
        tx.name,
        tx.merchantName,
        tx.amountCents,
        tx.currency,
        tx.pending,
        tx.categoryPrimary,
        tx.categoryDetailed,
      ],
    )
    touched.push(rows[0]!.id)

    // When a pending charge posts, the bank sends a new transaction and
    // removes the pending one. Carry over what the owner set on it.
    if (tx.pendingProviderTransactionId) {
      await db.query(
        `UPDATE transactions posted SET
           category_id = CASE WHEN pending.category_source = 'manual' THEN pending.category_id ELSE posted.category_id END,
           category_source = CASE WHEN pending.category_source = 'manual' THEN 'manual' ELSE posted.category_source END,
           note = coalesce(posted.note, pending.note),
           excluded = posted.excluded OR pending.excluded
         FROM transactions pending
         WHERE posted.id = $1 AND pending.account_id = posted.account_id
           AND pending.provider_transaction_id = $2`,
        [rows[0]!.id, tx.pendingProviderTransactionId],
      )
    }
  }

  if (removed.length) {
    await db.query(
      `DELETE FROM transactions
       WHERE provider_transaction_id = ANY($1::text[]) AND account_id = ANY($2::uuid[])`,
      [removed, [...accountIds.values()]],
    )
  }
  return touched
}

/** Acts on a verified bank webhook. Unknown items are ignored. */
export async function handleBankWebhook(
  ctx: AppContext,
  itemId: string,
  event: 'sync' | 'needs_reauth' | 'repaired' | 'ignored',
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
