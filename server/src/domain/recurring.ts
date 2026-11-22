// Finding charges and deposits that repeat on a schedule: subscriptions,
// bills and paychecks, from transaction history alone.
//
// A series' key is its merchant key, made from the bank's text. An assistant
// is given one made from the shown name instead, since the bank's text may
// hold an account's number (see ruleText.ts): it tracks or dismisses a series
// by what it can see, and never learns what the bank wrote.

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { addCadence, type Cadence } from '../lib/periods.js'
import { accountMasks } from './accounts.js'
import { listBills, type Bill } from './bills.js'
import { countedSql } from './counted.js'
import { merchantKey, textKey } from './merchantKey.js'
import { shownNameOf } from './ruleText.js'
import type { AccountMasks } from './safeName.js'
import { merchantDisplayName } from './transactionName.js'
import type { Movement } from './transfers.js'

/** One past transaction, as detection needs it. Amounts are positive for money out. */
export interface PastTransaction {
  date: IsoDate
  merchantName: string | null
  name: string
  amountCents: number
  categoryId: string | null
  /** The account it came out of or went into. */
  accountId?: string
}

/** A past transaction as stored, with its id and what its shown name is worked out from. */
export type StoredTransaction = PastTransaction & Movement & { id: string }

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
  /** The account most of them came out of or went into. */
  accountId: string | null
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
  masks: AccountMasks,
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
    name: merchantDisplayName(last, { masks }),
    direction,
    cadence: band.cadence,
    typicalAmountCents: typical,
    amountVaries,
    count: days.length,
    lastDate: last.date,
    nextDate,
    categoryId: mostCommon(charges.map((c) => c.categoryId)),
    accountId: mostCommon(charges.map((c) => c.accountId ?? null)),
    suggestedKind: subscriptionLike ? 'subscription' : 'bill',
  }
}

/** A series found, with its transactions, oldest first, and the newest of them. */
interface Found<T extends PastTransaction> {
  series: RecurringSeries
  charges: T[]
  last: T
}

/**
 * Groups transactions by merchant and direction, and keeps the groups whose
 * dates repeat on a regular cadence and are still going. Sorted with the
 * soonest expected first. Names show none of the account masks given.
 */
export function detectRecurring(
  transactions: PastTransaction[],
  today: IsoDate,
  masks: AccountMasks,
): RecurringSeries[] {
  return findSeries(transactions, today, masks).map(({ series }) => series)
}

/** detectRecurring, keeping each series' newest transaction beside it. */
function findSeries<T extends PastTransaction>(
  transactions: T[],
  today: IsoDate,
  masks: AccountMasks,
): Found<T>[] {
  const groups = new Map<string, T[]>()
  for (const tx of transactions) {
    const key = merchantKey(tx)
    if (!key || tx.amountCents === 0) continue
    const direction = tx.amountCents > 0 ? 'out' : 'in'
    const group = `${direction}:${key}`
    const charges = groups.get(group)
    if (charges) charges.push(tx)
    else groups.set(group, [tx])
  }
  const found: Found<T>[] = []
  for (const [group, charges] of groups) {
    const [direction, key] = group.split(/:(.*)/s) as ['out' | 'in', string]
    charges.sort((a, b) => a.date.localeCompare(b.date))
    const series = seriesOf(key, direction, charges, today, masks)
    if (series) found.push({ series, charges, last: charges.at(-1)! })
  }
  return found.sort(
    (a, b) =>
      a.series.nextDate.localeCompare(b.series.nextDate) ||
      a.series.key.localeCompare(b.series.key),
  )
}

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
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType"
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

/** Who asks for repeating charges: an assistant is given keys made from shown names. */
interface Asker {
  forAssistant?: boolean
}

/** A series not tracked or dismissed yet, with the key made from its shown name. */
export interface Untracked {
  series: RecurringSeries
  shownKey: string
}

/**
 * Whether a bill tracks a series: its pattern, read as a merchant key, is
 * part of the series' key. A bill that reads shown names is compared with the
 * key made from the shown name, never the bank's text.
 */
function tracks(bill: Bill, { series, shownKey }: Untracked): boolean {
  const pattern = bill.matchPattern ? textKey(bill.matchPattern) : ''
  if (!pattern) return false
  return (bill.reads === 'shown_name' ? shownKey : series.key).includes(pattern)
}

/** Series still repeating that are neither dismissed nor tracked by a bill yet. */
export async function untracked(db: Db, today: IsoDate): Promise<Untracked[]> {
  const [history, dismissed, bills, masks] = await Promise.all([
    recentHistory(db, today),
    dismissedKeys(db),
    listBills(db, today),
    accountMasks(db),
  ])
  return findSeries(history, today, masks)
    .map(({ series, last }) => ({ series, shownKey: textKey(shownNameOf(last, masks)) }))
    .filter((found) => !dismissed.has(found.series.key) && !bills.some((b) => tracks(b, found)))
}

/**
 * Charges still repeating that no bill tracks, dismissed suggestions too, each
 * with its transactions, oldest first. Leak checks read these: a price rise is
 * news whether or not the owner wants the charge suggested as a bill.
 */
export async function untrackedSeries(
  db: Db,
  today: IsoDate,
): Promise<(Untracked & { charges: StoredTransaction[] })[]> {
  const [history, bills, masks] = await Promise.all([
    recentHistory(db, today),
    listBills(db, today),
    accountMasks(db),
  ])
  return findSeries(history, today, masks)
    .map(({ series, charges, last }) => ({
      series,
      charges,
      shownKey: textKey(shownNameOf(last, masks)),
    }))
    .filter((found) => !bills.some((bill) => tracks(bill, found)))
}

/**
 * Series still repeating that are neither dismissed nor tracked yet. An
 * assistant gets each one keyed by its shown name ('' when it has no name the
 * app can show), which is what it passes back to track or dismiss it.
 */
export async function untrackedRecurring(
  db: Db,
  today: IsoDate,
  { forAssistant = false }: Asker = {},
): Promise<RecurringSeries[]> {
  const found = await untracked(db, today)
  return found.map(({ series, shownKey }) => (forAssistant ? { ...series, key: shownKey } : series))
}

/**
 * Stops suggesting a series. The owner's app passes the series' own key. An
 * assistant passes the key it was given, which dismisses every series
 * suggested now under that shown name, and is not found when none is.
 */
export async function dismissRecurring(
  db: Db,
  key: string,
  today: IsoDate,
  { forAssistant = false }: Asker = {},
): Promise<void> {
  const keys = forAssistant
    ? (await untracked(db, today)).filter((f) => f.shownKey === key).map((f) => f.series.key)
    : [key]
  if (keys.length === 0) throw notFound('Recurring charge')
  await db.query(
    'INSERT INTO dismissed_recurring (merchant_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING',
    [keys],
  )
}
