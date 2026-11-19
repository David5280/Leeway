// How savings balances moved: an account's change over a window, and the
// total over time. Pure. History is one balance per account per day, kept
// from the day Leeway first saw the account, so nothing here guesses at a
// balance from before that.

import { addDays, dateParts, makeDate, type IsoDate } from '../../lib/dates.js'
import { netWorthSeries, type BalanceSnapshot } from '../netWorth.js'

export interface BalancePoint {
  day: IsoDate
  cents: number
}

/** A change in balance from a starting day to today. */
export interface Change {
  changeCents: number
  /** The day the change is measured from. */
  since: IsoDate
}

/** The windows a change is measured over. */
export const CHANGE_WINDOWS = ['month', 'days30', 'year', 'all'] as const
export type ChangeWindow = (typeof CHANGE_WINDOWS)[number]
export type Changes = Record<ChangeWindow, Change | null>

/** The first day of each window that ends today. */
export function windowStart(window: Exclude<ChangeWindow, 'all'>, today: IsoDate): IsoDate {
  if (window === 'days30') return addDays(today, -30)
  if (window === 'year') return addDays(today, -365)
  const { year, month } = dateParts(today)
  return makeDate(year, month, 1)
}

/** The balance at the end of `day`: the last one recorded on or before it. Points are oldest first. */
export function balanceOn(points: BalancePoint[], day: IsoDate): BalancePoint | null {
  let found: BalancePoint | null = null
  for (const point of points) {
    if (point.day > day) break
    found = point
  }
  return found
}

/**
 * The change from the start of a window to the current balance. Null when
 * history does not reach back to the window's start, since the balance then
 * is unknown. The month is the exception: a change "this month" is useful
 * from the first day of history, so it is measured from there and says so.
 * Also null when there is nothing earlier than today to compare with.
 */
export function changeOver(
  window: ChangeWindow,
  points: BalancePoint[],
  currentCents: number,
  today: IsoDate,
): Change | null {
  const first = points[0]
  if (!first || first.day >= today) return null
  if (window === 'all') return { changeCents: currentCents - first.cents, since: first.day }
  const start = windowStart(window, today)
  const base = balanceOn(points, start)
  if (base) return { changeCents: currentCents - base.cents, since: start }
  if (window === 'month') return { changeCents: currentCents - first.cents, since: first.day }
  return null
}

/** Every window's change for one account. */
export function changesOf(points: BalancePoint[], currentCents: number, today: IsoDate): Changes {
  return {
    month: changeOver('month', points, currentCents, today),
    days30: changeOver('days30', points, currentCents, today),
    year: changeOver('year', points, currentCents, today),
    all: changeOver('all', points, currentCents, today),
  }
}

/** A combined change over several accounts, and how many had no history that far back. */
export interface CombinedChange extends Change {
  accountsLeftOut: number
}

/**
 * Adds up the accounts' changes over one window. An account without history
 * that far back is left out and counted, rather than its whole balance being
 * taken as a change. The combined change starts at the latest account's start.
 */
export function combineChanges(changes: (Change | null)[]): CombinedChange | null {
  const known = changes.filter((change): change is Change => change !== null)
  if (known.length === 0) return null
  return {
    changeCents: known.reduce((sum, change) => sum + change.changeCents, 0),
    since: known.map((change) => change.since).reduce((a, b) => (a > b ? a : b)),
    accountsLeftOut: changes.length - known.length,
  }
}

/** All windows combined, one account's changes per entry. */
export function combineAll(accounts: Changes[]): Record<ChangeWindow, CombinedChange | null> {
  const pick = (window: ChangeWindow) => combineChanges(accounts.map((changes) => changes[window]))
  return { month: pick('month'), days30: pick('days30'), year: pick('year'), all: pick('all') }
}

/**
 * The total of the accounts on each day a balance was recorded, oldest first,
 * ending today. An account keeps its last balance until a newer one arrives,
 * and appears from the day it was first seen.
 */
export function totalSeries(
  history: Map<string, BalancePoint[]>,
  from: IsoDate,
  today: IsoDate,
): BalancePoint[] {
  const snapshots: BalanceSnapshot[] = []
  for (const [accountId, points] of history) {
    for (const point of points) {
      snapshots.push({ accountId, day: point.day, balanceCents: point.cents })
    }
  }
  // Savings are all assets, so nothing is subtracted.
  return netWorthSeries(snapshots, new Set(), from, today).map((point) => ({
    day: point.date,
    cents: point.netWorthCents,
  }))
}
