// Finding charges and deposits that repeat on a schedule: subscriptions,
// bills and paychecks, from transaction history alone (recurringSeries.ts
// finds them). Which of them no bill tracks yet, and suggesting or
// dismissing those, is untrackedRecurring.ts.
//
// A series' key is its merchant key, made from the bank's text.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { countedSql } from './counted.js'
import type { LabelSubject } from './modelLabels.js'
import type { PastTransaction } from './recurringSeries.js'

export {
  detectRecurring,
  findSeries,
  type Found,
  type PastTransaction,
  type RecurringSeries,
} from './recurringSeries.js'

/** A past transaction as stored, with its id and what its names are worked out from. */
export type StoredTransaction = PastTransaction & LabelSubject & { id: string }

/** How far back detection looks: long enough to see two yearly charges. */
const HISTORY_DAYS = 400

/**
 * Posted, counted transactions from the last HISTORY_DAYS, oldest first.
 * Transfers are left out: a monthly card payment is neither a bill nor, seen
 * from the card's side, a paycheck.
 */
export async function recentHistory(db: Db, today: IsoDate): Promise<StoredTransaction[]> {
  const { rows } = await db.query<StoredTransaction>(
    `SELECT t.id, t.date, t.merchant_name AS "merchantName", t.name, t.amount_cents AS "amountCents",
       t.category_id AS "categoryId", t.account_id AS "accountId",
       t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       t.merchant_entity_id AS "merchantEntityId",
       (t.provider_transaction_id IS NULL) AS "typedOrImported"
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.pending AND NOT t.excluded AND NOT a.hidden AND t.date BETWEEN $1 AND $2
       AND ${countedSql()}
     ORDER BY t.date, t.id`,
    [addDays(today, -HISTORY_DAYS), today],
  )
  return rows
}
