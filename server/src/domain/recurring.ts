// Finding charges and deposits that repeat on a schedule: subscriptions,
// bills and paychecks, from transaction history alone.

import type { Db } from '../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { addCadence, type Cadence } from '../lib/periods.js'
import { listBills } from './bills.js'
import { countedSql } from './counted.js'
import { merchantDisplayName } from './transactionName.js'

/** One past transaction, as detection needs it. Amounts are positive for money out. */
export interface PastTransaction {
  date: IsoDate
  merchantName: string | null
  name: string
  amountCents: number
  categoryId: string | null
}

export interface RecurringSeries {
  /** Stable key for the merchant, used to dismiss a suggestion and to match it again. */
  key: string
  /** The merchant name as it appeared most recently. */
  name: string
  direction: 'out' | 'in'
  cadence: Cadence
  /** The median amount, always positive. */
  typicalAmountCents: number
  /** False when every charge was within a few percent of the typical amount. */
  amountVaries: boolean
  count: number
  lastDate: IsoDate
  /** When the next one is expected. */
  nextDate: IsoDate
  /** The category most of them were filed under, if any. */
  categoryId: string | null
  /** A fixed monthly or yearly charge reads as a subscription; anything else as a bill. */
  suggestedKind: 'bill' | 'subscription'
}

/**
 * The gap in days each cadence allows between two charges. Banks post a day
 * or two late and months differ in length, so each band has some slack.
 */
const CADENCE_BANDS: { cadence: Cadence; min: number; max: number; minCount: number }[] = [
  { cadence: 'week', min: 6, max: 8, minCount: 4 },
  { cadence: 'biweek', min: 12, max: 16, minCount: 3 },
  { cadence: 'month', min: 27, max: 33, minCount: 3 },
  { cadence: 'quarter', min: 85, max: 97, minCount: 2 },
  { cadence: 'year', min: 355, max: 375, minCount: 2 },
]

/** Share of gaps that must fit the cadence. One skipped or doubled month is tolerated. */
const REGULAR_SHARE = 0.75
/** Amounts within this share of the median count as the same price. */
const FIXED_AMOUNT_TOLERANCE = 0.05

/**
 * The merchant name reduced to what stays the same between charges:
 * "NETFLIX.COM 8473 CA" and "Netflix.com 1192 CA" both become "netflix com ca".
 * The SQL function merchant_key() (migration 003) does the same for bill matching.
 */
export function merchantKey(tx: Pick<PastTransaction, 'merchantName' | 'name'>): string {
  return (tx.merchantName ?? tx.name)
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/**
 * The cadence whose band most gaps fall in, if enough of them do. The bands
 * do not overlap, so at most one can hold the regular share of the gaps.
 */
function cadenceOfGaps(gaps: number[]): (typeof CADENCE_BANDS)[number] | null {
  for (const band of CADENCE_BANDS) {
    const fitting = gaps.filter((gap) => gap >= band.min && gap <= band.max).length
    if (gaps.length + 1 >= band.minCount && fitting / gaps.length >= REGULAR_SHARE) return band
  }
  return null
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  for (const [value, count] of counts) if (!best || count > counts.get(best)!) best = value
  return best
}

/** Reads one merchant's charges (same direction, oldest first) as a series, if they repeat. */
function seriesOf(
  key: string,
  direction: 'out' | 'in',
  charges: PastTransaction[],
  today: IsoDate,
): RecurringSeries | null {
  // Two charges on the same day (a split payment) count as one occurrence.
  const days = [...new Set(charges.map((c) => c.date))]
  const gaps = days.slice(1).map((day, i) => daysBetween(days[i]!, day))
  const band = gaps.length > 0 ? cadenceOfGaps(gaps) : null
  if (!band) return null

  const last = charges.at(-1)!
  const nextDate = addCadence(last.date, band.cadence)
  // A series that missed more than half a cycle past its next date has stopped.
  if (daysBetween(nextDate, today) > band.max / 2) return null

  const amounts = charges.map((c) => Math.abs(c.amountCents))
  const typical = median(amounts)
  const amountVaries = amounts.some((a) => Math.abs(a - typical) > typical * FIXED_AMOUNT_TOLERANCE)
  const subscriptionLike =
    direction === 'out' && !amountVaries && (band.cadence === 'month' || band.cadence === 'year')
  return {
    key,
    name: merchantDisplayName(last),
    direction,
    cadence: band.cadence,
    typicalAmountCents: typical,
    amountVaries,
    count: days.length,
    lastDate: last.date,
    nextDate,
    categoryId: mostCommon(charges.map((c) => c.categoryId)),
    suggestedKind: subscriptionLike ? 'subscription' : 'bill',
  }
}

/**
 * Groups transactions by merchant and direction, and keeps the groups whose
 * dates repeat on a regular cadence and are still going. Sorted with the
 * soonest expected first.
 */
export function detectRecurring(
  transactions: PastTransaction[],
  today: IsoDate,
): RecurringSeries[] {
  const groups = new Map<string, PastTransaction[]>()
  for (const tx of transactions) {
    const key = merchantKey(tx)
    if (!key || tx.amountCents === 0) continue
    const direction = tx.amountCents > 0 ? 'out' : 'in'
    const group = `${direction}:${key}`
    const charges = groups.get(group)
    if (charges) charges.push(tx)
    else groups.set(group, [tx])
  }
  const found: RecurringSeries[] = []
  for (const [group, charges] of groups) {
    const [direction, key] = group.split(/:(.*)/s) as ['out' | 'in', string]
    charges.sort((a, b) => a.date.localeCompare(b.date))
    const series = seriesOf(key, direction, charges, today)
    if (series) found.push(series)
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.key.localeCompare(b.key))
}

/** How far back detection looks: long enough to see two yearly charges. */
const HISTORY_DAYS = 400

/**
 * Posted, counted transactions from the last HISTORY_DAYS, oldest first.
 * Transfers are left out: a monthly card payment is neither a bill nor, seen
 * from the card's side, a paycheck.
 */
export async function recentHistory(db: Db, today: IsoDate): Promise<PastTransaction[]> {
  const { rows } = await db.query<PastTransaction>(
    `SELECT t.date, t.merchant_name AS "merchantName", t.name, t.amount_cents AS "amountCents",
       t.category_id AS "categoryId"
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.pending AND NOT t.excluded AND NOT a.hidden AND t.date BETWEEN $1 AND $2
       AND ${countedSql()}
     ORDER BY t.date`,
    [addDays(today, -HISTORY_DAYS), today],
  )
  return rows
}

async function dismissedKeys(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    'SELECT merchant_key AS key FROM dismissed_recurring',
  )
  return new Set(rows.map((row) => row.key))
}

export async function dismissRecurring(db: Db, key: string): Promise<void> {
  await db.query(
    'INSERT INTO dismissed_recurring (merchant_key) VALUES ($1) ON CONFLICT DO NOTHING',
    [key],
  )
}

/**
 * Series still repeating that are neither dismissed nor tracked yet. A series
 * is tracked when a bill's pattern, read the same way as merchant names, is
 * part of its key.
 */
export async function untrackedRecurring(db: Db, today: IsoDate): Promise<RecurringSeries[]> {
  const [history, dismissed, bills] = await Promise.all([
    recentHistory(db, today),
    dismissedKeys(db),
    listBills(db, today),
  ])
  const patterns = bills.flatMap((b) =>
    b.matchPattern ? [merchantKey({ merchantName: b.matchPattern, name: '' })] : [],
  )
  return detectRecurring(history, today).filter(
    (s) => !dismissed.has(s.key) && !patterns.some((p) => s.key.includes(p)),
  )
}
