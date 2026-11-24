// The savings rate month by month, as the savings rate chart reads it: what a
// finished month usually saves, and the level each month is drawn against.
// Pure. The server counts each month (bank transfers to savings, plus the
// pension and the 401(k), 457 or 403(b) Leeway knows from when each began)
// and leaves off a month the bank history starts partway through. A month with
// no rate is unknown, never zero, since a payroll deduction Leeway does not
// know never reaches the bank. The usual month is the middle one, so a single
// month that moved a lump into savings does not set what usual means.

import type { Output } from '../api/client'

export type SavingsRates = Output<'get_savings_rates'>
export type MonthRate = SavingsRates['months'][number]

/** The months from the first with pay or saving seen, leaving off those before the bank history. */
export function fromFirstMonth(months: MonthRate[]): MonthRate[] {
  const first = months.findIndex(
    (month) => month.current || month.payCents > 0 || month.savedCents > 0,
  )
  return months.slice(Math.max(0, first))
}

/** The middle rate of the finished months that have one, or null before there is one. */
export function usualRate(months: MonthRate[]): number | null {
  const known = months
    .filter((month) => !month.current && month.percent !== null)
    .map((month) => month.percent!)
    .sort((a, b) => a - b)
  if (known.length === 0) return null
  const middle = Math.floor(known.length / 2)
  // An even count has two middles; their average is the median.
  const median = known.length % 2 ? known[middle]! : (known[middle - 1]! + known[middle]!) / 2
  return Math.round(median)
}

/**
 * The dashed level the bars read against: the owner's own target when they
 * set one, otherwise the usual month, so nothing reads as short of a target
 * they never chose.
 */
export function rateLevel(rates: SavingsRates): { percent: number; label: string } | null {
  if (rates.targetPercent !== null) return { percent: rates.targetPercent, label: 'Your target' }
  const usual = usualRate(rates.months)
  return usual === null ? null : { percent: usual, label: 'Usual' }
}

/** Whether a month reached the owner's own target; false without one. */
export function reachedTarget(month: MonthRate, targetPercent: number | null): boolean {
  return targetPercent !== null && month.percent !== null && month.percent >= targetPercent
}
