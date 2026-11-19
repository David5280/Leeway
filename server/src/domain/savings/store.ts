// Reads what the savings report needs from Postgres: the accounts, their
// balance history and the transfers that fed them. Queries only; the rules
// live in the pure modules next to this one.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { listAccounts, type Account } from '../accounts.js'
import { CONTRIBUTION_DAYS, type TransferCandidate } from './contributions.js'
import type { BalancePoint } from './history.js'

/** Every counted (not hidden) account, savings or not. */
export async function countedAccounts(db: Db): Promise<Account[]> {
  return listAccounts(db, false)
}

/**
 * Each account's recorded balances before today, oldest first. Today's
 * balance is the account's current one, which the caller adds, so a day
 * recorded ahead of the owner's calendar (by an older server's clock) never
 * counts twice or as the future.
 */
export async function balanceHistory(
  db: Db,
  accountIds: string[],
  today: IsoDate,
): Promise<Map<string, BalancePoint[]>> {
  const byAccount = new Map<string, BalancePoint[]>(accountIds.map((id) => [id, []]))
  if (accountIds.length === 0) return byAccount
  const { rows } = await db.query<BalancePoint & { accountId: string }>(
    `SELECT account_id AS "accountId", day, balance_cents AS cents FROM balance_history
     WHERE account_id = ANY($1::uuid[]) AND day < $2
     ORDER BY day`,
    [accountIds, today],
  )
  for (const { accountId, ...point } of rows) byAccount.get(accountId)!.push(point)
  return byAccount
}

/**
 * Posted transactions in the last year on counted accounts outside savings,
 * that the bank labeled as a transfer to savings or investments.
 */
export async function transferCandidates(
  db: Db,
  everydayAccountIds: string[],
  today: IsoDate,
): Promise<TransferCandidate[]> {
  if (everydayAccountIds.length === 0) return []
  const { rows } = await db.query<TransferCandidate>(
    `SELECT date, amount_cents AS "amountCents",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE account_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3
       AND NOT excluded AND NOT pending
       AND provider_category_detailed IN
         ('TRANSFER_OUT_SAVINGS', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS')`,
    [everydayAccountIds, addDays(today, -(CONTRIBUTION_DAYS - 1)), today],
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
