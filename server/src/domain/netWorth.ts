// Net worth: what the owner has minus what they owe, now and over time. A
// balance on the other side of zero counts on the other side: an overpaid
// credit card (the bank owes the owner) is something owned, and an overdrawn
// account is something owed, so neither total ever reads as a negative.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { LIABILITY_TYPES } from './accounts.js'
import {
  historyStart,
  rebuildable,
  rebuildBalances,
  type PostedMovement,
  type RebuildAccount,
} from './netWorthRebuild.js'

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
  /** The first day history can reach, or null before any balance is known. */
  historyStart: IsoDate | null
  /** Points before this day are estimated (see netWorthRebuild.ts); null when none are. */
  estimatedBefore: IsoDate | null
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
 *
 * With `estimate`, history reaches back before balances were first recorded
 * (netWorthRebuild.ts), for a chart over a range. Without it, history is
 * recorded balances only, for a change stated as a plain fact (the check-in,
 * the home screen widget).
 */
export async function getNetWorth(
  db: Db,
  today: IsoDate,
  days: number,
  { estimate = false }: { estimate?: boolean } = {},
): Promise<NetWorth> {
  const { rows: accounts } = await db.query<RebuildAccount & { balanceCents: number | null }>(
    `SELECT id, type, balance_cents AS "balanceCents", connection_id IS NOT NULL AS banked
     FROM accounts WHERE NOT hidden AND unshared_at IS NULL`,
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

  const { rows: real } = await db.query<BalanceSnapshot>(
    `SELECT h.account_id AS "accountId", h.day, h.balance_cents AS "balanceCents"
     FROM balance_history h JOIN accounts a ON a.id = h.account_id
     WHERE NOT a.hidden AND a.unshared_at IS NULL AND h.day <= $1`,
    [today],
  )
  const movements = estimate ? await postedMovements(db, accounts, today) : []
  const start = historyStart(real, movements)
  const from = addDays(today, -days)
  const rebuilt = estimate
    ? rebuildBalances(accounts, real, movements, start !== null && start > from ? start : from)
    : { snapshots: [], estimatedBefore: null }
  const history = netWorthSeries([...real, ...rebuilt.snapshots], liabilities, from, today)
  return {
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    history,
    historyStart: start,
    // Only when the history shown reaches into the estimate.
    estimatedBefore:
      rebuilt.estimatedBefore !== null && (history[0]?.date ?? today) < rebuilt.estimatedBefore
        ? rebuilt.estimatedBefore
        : null,
  }
}

/** Posted transactions on the accounts whose past balances they can rebuild, up to today. */
async function postedMovements(
  db: Db,
  accounts: RebuildAccount[],
  today: IsoDate,
): Promise<PostedMovement[]> {
  const ids = accounts.filter(rebuildable).map((account) => account.id)
  // As totals read them: none left out (a duplicate, say), and none still pending.
  const { rows } = await db.query<PostedMovement>(
    `SELECT account_id AS "accountId", date, amount_cents AS "amountCents" FROM transactions
     WHERE account_id = ANY($1::uuid[]) AND NOT pending AND NOT excluded AND date <= $2`,
    [ids, today],
  )
  return rows
}
