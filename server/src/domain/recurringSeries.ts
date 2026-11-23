// Finding charges and deposits that repeat on a schedule in a list of
// transactions: subscriptions, bills and paychecks (recurring.ts reads the
// transactions and what the owner tracks or dismissed). Pure.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import { addCadence, type Cadence } from '../lib/periods.js'
import { CADENCE_BANDS, type CadenceBand } from './cadenceBands.js'
import { merchantKey } from './merchantKey.js'
import type { AccountMasks } from './safeName.js'
import { merchantDisplayName } from './transactionName.js'

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
  /** Set when the name could be anyone's: what a model is shown instead (modelLabels.ts). */
  modelLabel?: string
}

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
function cadenceOfGaps(gaps: number[]): CadenceBand | null {
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
export interface Found<T extends PastTransaction> {
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

/** detectRecurring, keeping each series' transactions, oldest first, and its newest beside it. */
export function findSeries<T extends PastTransaction>(
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
