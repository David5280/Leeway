// Bank sync: pulling a connection's accounts and transaction changes in from
// the bank and applying them, all at once or not at all.

import type pg from 'pg'
import type { BankAccount, BankProvider, BankTransaction } from '../bank/provider.js'
import { BankError } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import { withTransaction } from '../db/pool.js'
import { messageOf, notFound } from '../errors.js'
import { accessTokenOf, requireBank } from './bank.js'
import { loadOwnAccounts, recategorize } from './categorize.js'
import { sameOwnAccounts } from './transfers.js'
import { adoptHistory, settleReturns } from './returnedHistory.js'
import { markUnshared, reattachAccounts } from './unshared.js'

export interface SyncResult {
  connectionId: string
  institutionName: string | null
  added: number
  modified: number
  removed: number
  error: string | null
}

/** Everything that changed at the bank since a cursor, and where to continue from next time. */
export interface BankChanges {
  added: BankTransaction[]
  modified: BankTransaction[]
  removed: string[]
  cursor: string | null
}

/**
 * A guard against a bank that never stops saying there is more. At 500
 * transactions a page this is far beyond any real history; if it is ever
 * reached, the cursor saved so far lets the next sync carry on.
 */
const MAX_PAGES = 200

/**
 * Follows the bank's pages from `cursor` until it has nothing more. A null
 * cursor starts from the beginning, which returns the whole history the bank
 * holds as `added`.
 */
export async function fetchChanges(
  bank: BankProvider,
  token: string,
  cursor: string | null,
): Promise<BankChanges> {
  const changes: BankChanges = { added: [], modified: [], removed: [], cursor }
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await bank.syncTransactions(token, changes.cursor)
    changes.added.push(...result.added)
    changes.modified.push(...result.modified)
    changes.removed.push(...result.removed)
    changes.cursor = result.nextCursor
    if (!result.hasMore) break
  }
  return changes
}

/**
 * Pulls everything that changed at the bank since the last sync. All pages
 * are fetched before anything is written, then applied in one database
 * transaction with the new cursor, so a failure halfway leaves no partial
 * state and the next sync simply retries from the old cursor.
 *
 * A bank failure is recorded on the connection and returned as the result's
 * error, so one broken bank never stops a sync of all of them. Anything else
 * is recorded and thrown.
 */
export async function syncConnection(ctx: AppContext, connectionId: string): Promise<SyncResult> {
  const bank = requireBank(ctx)
  const { rows } = await ctx.db.query<{ cursor: string | null; institutionName: string | null }>(
    'SELECT sync_cursor AS cursor, institution_name AS "institutionName" FROM connections WHERE id = $1',
    [connectionId],
  )
  if (!rows[0]) throw notFound('Connection')
  const { institutionName } = rows[0]

  try {
    const token = await accessTokenOf(ctx, connectionId)
    const accounts = await bank.getAccounts(token)
    const changes = await fetchChanges(bank, token, rows[0].cursor)
    await withTransaction(ctx.db, (db) => applySync(db, connectionId, accounts, changes))
    return {
      connectionId,
      institutionName,
      added: changes.added.length,
      modified: changes.modified.length,
      removed: changes.removed.length,
      error: null,
    }
  } catch (error) {
    const message = messageOf(error)
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

/** Syncs every connection, one at a time, oldest first; one broken bank does not stop the others. */
export async function syncAll(ctx: AppContext): Promise<SyncResult[]> {
  const { rows } = await ctx.db.query<{ id: string }>(
    'SELECT id FROM connections ORDER BY created_at',
  )
  const results: SyncResult[] = []
  for (const { id } of rows) results.push(await syncConnection(ctx, id))
  return results
}

/**
 * Writes one sync's accounts and changes, re-files what they touched, and
 * saves the cursor. Accounts the bank stopped reporting are marked as no
 * longer shared, and ones it reports again come back as the accounts they
 * were, with their history (see unshared.ts and returnedHistory.ts).
 */
async function applySync(
  db: pg.PoolClient,
  connectionId: string,
  accounts: BankAccount[],
  changes: BankChanges,
): Promise<void> {
  const cardsBefore = await loadOwnAccounts(db)
  const held = await reattachAccounts(db, connectionId, accounts)
  const accountIds = await upsertAccounts(db, connectionId, accounts)
  await markUnshared(db, connectionId, accounts)
  const arrived = [...changes.added, ...changes.modified]
  const adopted = await adoptHistory(db, connectionId, accountIds, arrived)
  const touched = await upsertTransactions(db, accountIds, arrived)
  await carryOverPendingEdits(db, touched)
  await settleReturns(db, held, adopted, touched)
  await removeTransactions(db, accountIds, changes.removed)
  // A newly tracked card turns earlier payments to it into transfers, so
  // when the cards change every transaction is looked at again.
  const cardsChanged = !sameOwnAccounts(cardsBefore, await loadOwnAccounts(db))
  await recategorize(db, cardsChanged ? undefined : touched)
  await db.query(
    `UPDATE connections SET sync_cursor = $2, last_synced_at = now(), status = 'active', last_error = NULL
     WHERE id = $1`,
    [connectionId, changes.cursor],
  )
}

/**
 * Saves the bank's accounts, as shared again if they had been unshared;
 * returns each one's id here by the bank's id for it.
 */
async function upsertAccounts(
  db: pg.PoolClient,
  connectionId: string,
  accounts: BankAccount[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  // One at a time: a connection has a handful of accounts, and each balance
  // change is recorded in the balance history by a row trigger anyway.
  for (const a of accounts) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO accounts (connection_id, provider_account_id, name, official_name, mask, type, subtype,
         balance_cents, available_cents, credit_limit_cents, currency, balance_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (connection_id, provider_account_id) DO UPDATE SET
         name = EXCLUDED.name, official_name = EXCLUDED.official_name, mask = EXCLUDED.mask,
         type = EXCLUDED.type, subtype = EXCLUDED.subtype, balance_cents = EXCLUDED.balance_cents,
         available_cents = EXCLUDED.available_cents, credit_limit_cents = EXCLUDED.credit_limit_cents,
         currency = EXCLUDED.currency, balance_updated_at = now(), unshared_at = NULL
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

/**
 * The newest version of each transaction, in first-seen order. One upsert
 * statement may not touch a row twice, and a sync can name a transaction in
 * both its added and modified lists.
 */
export function latestOfEach(transactions: BankTransaction[]): BankTransaction[] {
  const byKey = new Map<string, BankTransaction>()
  for (const tx of transactions) {
    byKey.set(`${tx.providerAccountId}\u0000${tx.providerTransactionId}`, tx)
  }
  return [...byKey.values()]
}

/**
 * Adds or updates transactions in one statement (a first sync can bring
 * thousands) and returns the ids of the rows written. Transactions on an
 * account the bank no longer reports are skipped.
 */
async function upsertTransactions(
  db: pg.PoolClient,
  accountIds: Map<string, string>,
  transactions: BankTransaction[],
): Promise<string[]> {
  const known = latestOfEach(transactions).filter((tx) => accountIds.has(tx.providerAccountId))
  if (known.length === 0) return []
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO transactions (account_id, provider_transaction_id, pending_provider_transaction_id,
       date, name, merchant_name, amount_cents, currency, pending,
       provider_category_primary, provider_category_detailed)
     SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::date[], $5::text[], $6::text[],
       $7::bigint[], $8::text[], $9::boolean[], $10::text[], $11::text[])
     ON CONFLICT (account_id, provider_transaction_id) DO UPDATE SET
       pending_provider_transaction_id = EXCLUDED.pending_provider_transaction_id,
       date = EXCLUDED.date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name,
       amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency, pending = EXCLUDED.pending,
       provider_category_primary = EXCLUDED.provider_category_primary,
       provider_category_detailed = EXCLUDED.provider_category_detailed,
       updated_at = now()
     RETURNING id`,
    [
      known.map((tx) => accountIds.get(tx.providerAccountId)),
      known.map((tx) => tx.providerTransactionId),
      known.map((tx) => tx.pendingProviderTransactionId),
      known.map((tx) => tx.date),
      known.map((tx) => tx.name),
      known.map((tx) => tx.merchantName),
      known.map((tx) => tx.amountCents),
      known.map((tx) => tx.currency),
      known.map((tx) => tx.pending),
      known.map((tx) => tx.categoryPrimary),
      known.map((tx) => tx.categoryDetailed),
    ],
  )
  return rows.map((row) => row.id)
}

/**
 * When a pending charge posts, the bank sends the posted one as a new
 * transaction naming the pending one, and removes the pending one in the same
 * sync. Before it goes, what the owner set on it (a category picked by hand,
 * a note, leaving it out of totals) carries over to the posted one. The match
 * is by the bank's ids, never by date or amount, so a posted charge whose
 * date or amount changed still carries over and is never doubled.
 */
async function carryOverPendingEdits(db: pg.PoolClient, touched: string[]): Promise<void> {
  if (touched.length === 0) return
  await db.query(
    `UPDATE transactions posted SET
       category_id = CASE WHEN pending.category_source = 'manual' THEN pending.category_id ELSE posted.category_id END,
       category_source = CASE WHEN pending.category_source = 'manual' THEN 'manual' ELSE posted.category_source END,
       note = coalesce(posted.note, pending.note),
       excluded = posted.excluded OR pending.excluded
     FROM transactions pending
     WHERE posted.id = ANY($1::uuid[])
       AND pending.account_id = posted.account_id
       AND pending.provider_transaction_id = posted.pending_provider_transaction_id`,
    [touched],
  )
}

/** Deletes transactions the bank removed, such as a pending charge that has posted. */
async function removeTransactions(
  db: pg.PoolClient,
  accountIds: Map<string, string>,
  removed: string[],
): Promise<void> {
  if (removed.length === 0) return
  await db.query(
    `DELETE FROM transactions
     WHERE provider_transaction_id = ANY($1::text[]) AND account_id = ANY($2::uuid[])`,
    [removed, [...accountIds.values()]],
  )
}
