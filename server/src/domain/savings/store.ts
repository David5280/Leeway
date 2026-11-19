// Reads what the savings report needs from Postgres: balance history and the
// transfers that fed savings. Queries only; the rules live in the pure modules
// next to this one.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { CONTRIBUTION_CODES, CONTRIBUTION_DAYS, type TransferCandidate } from './contributions.js'
import type { BalancePoint } from './history.js'

/**
 * Each account's recorded balances before today, oldest first. Today's
 * balance is the account's current one, which the caller adds, so a day
 * recorded ahead of the owner's calendar (by an older server's clock) never
 * counts twice or as the future.
 *
 * With `through`, only what a change measured from the close of that day
 * needs: each account's last balance on or before it, and everything after.
 * An account with nothing that early keeps all its points, so its first day
 * of history is still there to measure from.
 */
export async function balanceHistory(
  db: Db,
  accountIds: string[],
  today: IsoDate,
  through: IsoDate | null = null,
): Promise<Map<string, BalancePoint[]>> {
  const byAccount = new Map<string, BalancePoint[]>(accountIds.map((id) => [id, []]))
  if (accountIds.length === 0) return byAccount
  const { rows } = await db.query<BalancePoint & { accountId: string }>(
    `SELECT account_id AS "accountId", day, balance_cents AS cents FROM balance_history h
     WHERE account_id = ANY($1::uuid[]) AND day < $2
       AND ($3::date IS NULL OR day >= coalesce(
         (SELECT max(day) FROM balance_history e WHERE e.account_id = h.account_id AND e.day <= $3),
         '-infinity'))
     ORDER BY day`,
    [accountIds, today, through],
  )
  for (const { accountId, ...point } of rows) byAccount.get(accountId)!.push(point)
  return byAccount
}

/**
 * Posted transactions in the last year on counted accounts outside savings,
 * in the owner's currency, that the bank labeled as money moved to or from
 * savings or investments.
 */
export async function transferCandidates(
  db: Db,
  everydayAccountIds: string[],
  currency: string,
  today: IsoDate,
): Promise<TransferCandidate[]> {
  if (everydayAccountIds.length === 0) return []
  const { rows } = await db.query<TransferCandidate>(
    `SELECT date, amount_cents AS "amountCents",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE account_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3
       AND NOT excluded AND NOT pending
       AND currency = $4 AND provider_category_detailed = ANY($5::text[])`,
    [
      everydayAccountIds,
      addDays(today, -(CONTRIBUTION_DAYS - 1)),
      today,
      currency,
      CONTRIBUTION_CODES,
    ],
  )
  return rows
}

/** The earliest transaction held on these accounts, or null when there are none. */
export async function firstTransactionDate(db: Db, accountIds: string[]): Promise<IsoDate | null> {
  if (accountIds.length === 0) return null
  const { rows } = await db.query<{ first: IsoDate | null }>(
    'SELECT min(date) AS first FROM transactions WHERE account_id = ANY($1::uuid[])',
    [accountIds],
  )
  return rows[0]!.first
}
