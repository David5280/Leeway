// Each account's balance day by day over the last few weeks, for the small
// line on an account's card. A balance is stored only on the days it changed
// (balance_history), so each day carries the last one known.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'

/** How many days back the line reaches, today included. */
export const RECENT_BALANCE_DAYS = 30

/** A balance as stored: on the day it changed. */
export interface BalanceChange {
  day: IsoDate
  balanceCents: number
}

export interface RecentBalances {
  accountId: string
  /** One balance a day, oldest first, from the first day one is known; empty for none. */
  balancesCents: number[]
}

/**
 * One balance a day from `from` to `to`, both inclusive, each day carrying
 * the last change on or before it. Days before any known balance are left
 * out. `changes` are oldest first.
 */
export function dailyBalances(changes: readonly BalanceChange[], from: IsoDate, to: IsoDate) {
  const balances: number[] = []
  let next = 0
  let known: number | null = null
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (next < changes.length && changes[next]!.day <= day) known = changes[next++]!.balanceCents
    if (known !== null) balances.push(known)
  }
  return balances
}

/** Every account's balances over the last RECENT_BALANCE_DAYS days, up to `today`. */
export async function recentBalances(db: Db, today: IsoDate): Promise<RecentBalances[]> {
  const from = addDays(today, -(RECENT_BALANCE_DAYS - 1))
  // The changes in the window, and the last one before it, which the window opens on.
  const { rows } = await db.query<BalanceChange & { accountId: string }>(
    `SELECT a.id AS "accountId", h.day, h.balance_cents AS "balanceCents"
     FROM accounts a LEFT JOIN balance_history h ON h.account_id = a.id AND h.day <= $2
       AND (h.day >= $1 OR h.day = (SELECT max(e.day) FROM balance_history e
                                    WHERE e.account_id = a.id AND e.day < $1))
     ORDER BY a.id, h.day`,
    [from, today],
  )
  const byAccount = new Map<string, BalanceChange[]>()
  for (const { accountId, day, balanceCents } of rows) {
    const changes = byAccount.get(accountId) ?? []
    if (day !== null) changes.push({ day, balanceCents })
    byAccount.set(accountId, changes)
  }
  return [...byAccount].map(([accountId, changes]) => ({
    accountId,
    balancesCents: dailyBalances(changes, from, today),
  }))
}
