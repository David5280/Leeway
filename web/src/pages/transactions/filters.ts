// The Transactions screen's filters, and grouping the list by day.

import type { Transaction } from '../../api/client'
import { isoDaysAgo } from '../../lib/dates'

export type Range = 'period' | '30' | 'all'

export const RANGES = [
  { value: 'period', label: 'This period' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All' },
] as const

/** The first date a range covers, or undefined for all time. */
export function rangeStart(
  range: Range,
  periodStart: string | undefined,
  timeZone: string,
  now = Date.now(),
): string | undefined {
  if (range === 'period') return periodStart
  if (range === '30') return isoDaysAgo(30, timeZone, now)
  return undefined
}

/** Groups newest-first transactions by day, keeping the order. */
export function groupByDay(transactions: Transaction[]): [string, Transaction[]][] {
  const groups: [string, Transaction[]][] = []
  for (const tx of transactions) {
    const last = groups[groups.length - 1]
    if (last && last[0] === tx.date) last[1].push(tx)
    else groups.push([tx.date, [tx]])
  }
  return groups
}
