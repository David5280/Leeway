// Net worth: what the owner has minus what they owe, now and over time.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { LIABILITY_TYPES, type AccountType } from './accounts.js'

export interface BalanceSnapshot {
  accountId: string
  day: IsoDate
  balanceCents: number
}

export interface NetWorthPoint {
  date: IsoDate
  /** What was owned that day, less what was owed. */
  netWorthCents: number
  assetsCents: number
  /** What was owed on credit cards and loans that day, positive. */
  liabilitiesCents: number
}

export interface NetWorth {
  assetsCents: number
  /** What is owed on credit cards and loans, positive. */
  liabilitiesCents: number
  netWorthCents: number
  /** One point per day a balance changed, oldest first. */
  history: NetWorthPoint[]
}

/**
 * Net worth on each day in the range that some balance was recorded. An
 * account keeps its last known balance until a newer one arrives, so the
 * range starts with balances recorded before it, if there are any.
 */
export function netWorthSeries(
  snapshots: BalanceSnapshot[],
  liabilities: Set<string>,
  from: IsoDate,
  to: IsoDate,
): NetWorthPoint[] {
  const latest = new Map<string, number>()
  const pointOn = (date: IsoDate): NetWorthPoint => {
    let assetsCents = 0
    let liabilitiesCents = 0
    for (const [id, cents] of latest) {
      if (liabilities.has(id)) liabilitiesCents += cents
      else assetsCents += cents
    }
    return { date, netWorthCents: assetsCents - liabilitiesCents, assetsCents, liabilitiesCents }
  }
  const sorted = [...snapshots].sort((a, b) => a.day.localeCompare(b.day))
  const points: NetWorthPoint[] = []
  for (const snapshot of sorted) {
    if (snapshot.day > to) break
    if (snapshot.day >= from && points.length === 0 && latest.size > 0) points.push(pointOn(from))
    latest.set(snapshot.accountId, snapshot.balanceCents)
    if (snapshot.day < from) continue
    // Several accounts change on one day: keep a single point for it.
    if (points.at(-1)?.date === snapshot.day) points.pop()
    points.push(pointOn(snapshot.day))
  }
  if (points.length === 0 && latest.size > 0) points.push(pointOn(from))
  return points
}

/** Current net worth from counted accounts, and its history over the last `days`. */
export async function getNetWorth(db: Db, today: IsoDate, days: number): Promise<NetWorth> {
  const { rows: accounts } = await db.query<{
    id: string
    type: AccountType
    balanceCents: number | null
  }>(`SELECT id, type, balance_cents AS "balanceCents" FROM accounts WHERE NOT hidden`)
  const liabilities = new Set(
    accounts.filter((a) => LIABILITY_TYPES.includes(a.type)).map((a) => a.id),
  )
  let assetsCents = 0
  let liabilitiesCents = 0
  for (const account of accounts) {
    if (account.balanceCents === null) continue
    if (liabilities.has(account.id)) liabilitiesCents += account.balanceCents
    else assetsCents += account.balanceCents
  }

  const { rows: snapshots } = await db.query<BalanceSnapshot>(
    `SELECT h.account_id AS "accountId", h.day, h.balance_cents AS "balanceCents"
     FROM balance_history h JOIN accounts a ON a.id = h.account_id
     WHERE NOT a.hidden AND h.day <= $1`,
    [today],
  )
  return {
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    history: netWorthSeries(snapshots, liabilities, addDays(today, -days), today),
  }
}
