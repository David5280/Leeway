// Moving bank transactions synced before Leeway used purchase dates onto the
// day of the purchase.
//
// Bank sync now dates a transaction by the day it was bought (Plaid's
// authorized_date) rather than the day it posted. Transactions synced earlier
// still carry the posted date. This asks each bank for its whole history again
// and corrects only the date of transactions Leeway already has, matched by
// the bank's own transaction id. Nothing is added or removed, the sync cursor
// is left alone, and categories, notes, splits and exclusions are untouched,
// so it is safe to run any number of times: a second run changes nothing.

import { BankError } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import { accessTokenOf, requireBank } from './bank.js'
import { fetchChanges, latestOfEach } from './sync.js'

export interface PurchaseDatesResult {
  connectionId: string
  institutionName: string | null
  /** Transactions the bank sent back. */
  checked: number
  /** Transactions whose date moved. */
  changed: number
  error: string | null
}

/**
 * Re-dates one connection's transactions. A bank failure is returned as the
 * result's error, so one broken bank does not stop the others; the
 * connection's sync status is not touched, because nothing was synced.
 */
async function redateConnection(
  ctx: AppContext,
  connection: { id: string; institutionName: string | null },
): Promise<PurchaseDatesResult> {
  const result: PurchaseDatesResult = {
    connectionId: connection.id,
    institutionName: connection.institutionName,
    checked: 0,
    changed: 0,
    error: null,
  }
  try {
    const token = await accessTokenOf(ctx, connection.id)
    // A null cursor asks for the whole history again; the stored cursor is not used or changed.
    const history = await fetchChanges(requireBank(ctx), token, null)
    const transactions = latestOfEach([...history.added, ...history.modified])
    result.checked = transactions.length
    if (transactions.length === 0) return result
    // One statement for the whole history; only rows whose date differs are written.
    const { rows: moved } = await ctx.db.query(
      `UPDATE transactions t SET date = v.date, updated_at = now()
       FROM unnest($2::text[], $3::text[], $4::date[]) AS v(account_ref, transaction_ref, date),
         accounts a
       WHERE a.connection_id = $1 AND a.provider_account_id = v.account_ref
         AND t.account_id = a.id AND t.provider_transaction_id = v.transaction_ref
         AND t.date <> v.date
       RETURNING t.id`,
      [
        connection.id,
        transactions.map((tx) => tx.providerAccountId),
        transactions.map((tx) => tx.providerTransactionId),
        transactions.map((tx) => tx.date),
      ],
    )
    result.changed = moved.length
  } catch (error) {
    if (!(error instanceof BankError)) throw error
    result.error = error.message
  }
  return result
}

/** Re-dates every connection's transactions, oldest connection first. */
export async function usePurchaseDates(ctx: AppContext): Promise<PurchaseDatesResult[]> {
  requireBank(ctx)
  const { rows } = await ctx.db.query<{ id: string; institutionName: string | null }>(
    'SELECT id, institution_name AS "institutionName" FROM connections ORDER BY created_at',
  )
  const results: PurchaseDatesResult[] = []
  for (const connection of rows) results.push(await redateConnection(ctx, connection))
  return results
}
