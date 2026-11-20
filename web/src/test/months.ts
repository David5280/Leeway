// A calendar month's totals as get_monthly_totals returns them, for tests.

import type { MonthlyTotals, MonthTotals } from '../lib/flows'

/** The months as get_monthly_totals returns them, the history starting where given. */
export function totalsOf(
  months: MonthTotals[],
  firstTransactionDate: string | null = null,
): MonthlyTotals {
  return { firstTransactionDate, months }
}

export function month(
  start: string,
  incomeCents: number,
  spentCents: number,
  current = false,
  unfiledInCents = 0,
): MonthTotals {
  return { start, end: start, current, incomeCents, spentCents, unfiledInCents, categories: [] }
}
