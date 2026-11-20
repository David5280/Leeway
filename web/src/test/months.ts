// A calendar month's totals as get_monthly_totals returns them, for tests.

import type { MonthTotals } from '../lib/flows'

export function month(
  start: string,
  incomeCents: number,
  spentCents: number,
  current = false,
): MonthTotals {
  return { start, end: start, current, incomeCents, spentCents, categories: [] }
}
