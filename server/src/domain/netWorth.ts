// Net worth: what the owner has minus what they owe, now and over time. A
// balance on the other side of zero counts on the other side: an overpaid
// credit card (the bank owes the owner) is something owned, and an overdrawn
// account is something owed, so neither total ever reads as a negative.

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
  /** What was owed that day, on credit cards, loans and any overdrawn account; never negative. */
  liabilitiesCents: number
}

export interface NetWorth {
  assetsCents: number
  /** What is owed on credit cards, loans and any overdrawn account; never negative. */
  liabilitiesCents: number
  netWorthCents: number
  /** One point per day a balance changed, oldest first. */
  history: NetWorthPoint[]
}

/** What is owned and what is owed, each never below zero. */
interface Totals {
  assetsCents: number
  liabilitiesCents: number
}

/** Adds one balance to what is owned or owed, by which side of zero it is on. */
function tally(totals: Totals, owedAccount: boolean, balanceCents: number): void {
  // A debt account shows what is owed as positive; anything else shows what is held.
  const held = owedAccount ? -balanceCents : balanceCents
  if (held >= 0) totals.assetsCents += held
  else totals.liabilitiesCents -= held
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
    const totals = { assetsCents: 0, liabilitiesCents: 0 }
    for (const [id, cents] of latest) tally(totals, liabilities.has(id), cents)
    return { date, netWorthCents: totals.assetsCents - totals.liabilitiesCents, ...totals }
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

/**
 * Current net worth from counted accounts, and its history over the last
 * `days`. Hidden accounts and ones the bank no longer shares are left out:
 * nothing keeps the balance of an unshared one current (unshared.ts).
 */
export async function getNetWorth(db: Db, today: IsoDate, days: number): Promise<NetWorth> {
  const { rows: accounts } = await db.query<{
    id: string
    type: AccountType
    balanceCents: number | null
  }>(
    `SELECT id, type, balance_cents AS "balanceCents" FROM accounts
     WHERE NOT hidden AND unshared_at IS NULL`,
  )
  const liabilities = new Set(
    accounts.filter((a) => LIABILITY_TYPES.includes(a.type)).map((a) => a.id),
  )
  const totals = { assetsCents: 0, liabilitiesCents: 0 }
  for (const account of accounts) {
    if (account.balanceCents !== null)
      tally(totals, liabilities.has(account.id), account.balanceCents)
  }
  const { assetsCents, liabilitiesCents } = totals

  const { rows: snapshots } = await db.query<BalanceSnapshot>(
    `SELECT h.account_id AS "accountId", h.day, h.balance_cents AS "balanceCents"
     FROM balance_history h JOIN accounts a ON a.id = h.account_id
     WHERE NOT a.hidden AND a.unshared_at IS NULL AND h.day <= $1`,
    [today],
  )
  return {
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    history: netWorthSeries(snapshots, liabilities, addDays(today, -days), today),
  }
}
