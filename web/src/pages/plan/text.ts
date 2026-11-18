// Plain-language labels for bills and debts, kept apart from the screens so they can be tested alone.

import type { Bill } from '../../api/client'
import { shortDate } from '../../lib/format'

export const BILL_CADENCES = {
  week: 'Weekly',
  biweek: 'Every 2 weeks',
  semimonth: 'Twice a month',
  month: 'Monthly',
  quarter: 'Every 3 months',
  year: 'Yearly',
} as const

export type BillCadence = keyof typeof BILL_CADENCES

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "Due today", "Due in 3 days" or "Due Dec 1", counted from today. */
export function dueText(date: string, daysUntil: number, locale: string): string {
  if (daysUntil === 0) return 'Due today'
  if (daysUntil === 1) return 'Due tomorrow'
  if (daysUntil > 1 && daysUntil < 7) return `Due in ${daysUntil} days`
  return `Due ${shortDate(date, locale)}`
}

/** Where a bill stands, in a few words, and the tone to show it in. */
export function billStatus(
  bill: Bill,
  locale: string,
): { text: string; tone: '' | 'good' | 'over' | 'warn' } {
  switch (bill.status) {
    case 'overdue':
      return { text: 'No payment found yet', tone: 'over' }
    case 'paid':
      return { text: `Paid ${shortDate(bill.lastPaidDate!, locale)}`, tone: 'good' }
    case 'due_soon':
      return { text: dueText(bill.nextDueDate, bill.daysUntilDue, locale), tone: 'warn' }
    default:
      return { text: dueText(bill.nextDueDate, bill.daysUntilDue, locale), tone: '' }
  }
}

/** "1 year 4 months" for a payoff time, or a plain answer when it never ends. */
export function durationText(months: number | null): string {
  if (months === null) return 'Never, at these payments'
  if (months === 0) return 'Paid off'
  const years = Math.floor(months / 12)
  const rest = months % 12
  return [years > 0 ? plural(years, 'year') : '', rest > 0 ? plural(rest, 'month') : '']
    .filter(Boolean)
    .join(' ')
}
