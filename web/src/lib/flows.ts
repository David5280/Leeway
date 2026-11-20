// Money in against money out, month by month: the shape the income and
// spending chart, its card and its drill-down read. Pure, so the math is
// tested on its own. The month still running is shown but never averaged,
// since its totals are only so far.

import type { Output } from '../api/client'

export type MonthTotals = Output<'get_monthly_totals'>[number]

export interface FlowMonth {
  start: string
  incomeCents: number
  spentCents: number
  /** What was left after spending: income less spending, negative when more went out. */
  keptCents: number
  current: boolean
}

export interface Flows {
  months: FlowMonth[]
  /** Averages over the finished months that had any money moving, or null before there is one. */
  usual: { incomeCents: number; spentCents: number; keptCents: number; count: number } | null
}

const average = (values: number[]) =>
  Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)

/** Each month's money in, out and kept, and what a finished month usually comes to. */
export function flowsFrom(totals: MonthTotals[]): Flows {
  // Empty months before the bank history starts are left off the chart, not drawn as zeros.
  const first = totals.findIndex(
    (month) => month.current || month.incomeCents !== 0 || month.spentCents !== 0,
  )
  const months = totals.slice(Math.max(0, first)).map((month) => ({
    start: month.start,
    incomeCents: month.incomeCents,
    spentCents: month.spentCents,
    keptCents: month.incomeCents - month.spentCents,
    current: month.current,
  }))
  // A month with nothing in or out is a gap in the history, not a month of zeros.
  const finished = months.filter(
    (month) => !month.current && (month.incomeCents !== 0 || month.spentCents !== 0),
  )
  if (finished.length === 0) return { months, usual: null }
  const incomeCents = average(finished.map((month) => month.incomeCents))
  const spentCents = average(finished.map((month) => month.spentCents))
  // Kept is the two averages' difference, so the drill-down's math adds up to the cent.
  return {
    months,
    usual: { incomeCents, spentCents, keptCents: incomeCents - spentCents, count: finished.length },
  }
}

/**
 * Whether a month's spending bar reads as a problem: a finished month where
 * more went out than came in. The running month is not judged yet.
 */
export function overspent(month: FlowMonth): boolean {
  return !month.current && month.keptCents < 0
}

/** The card's answer in a few words: kept or short each month, on average. */
export function flowsHeadline(flows: Flows): { cents: number; words: string } | null {
  if (!flows.usual) return null
  const { keptCents } = flows.usual
  if (keptCents < 0) return { cents: -keptCents, words: 'more out than in, a month' }
  return { cents: keptCents, words: 'kept a month, on average' }
}
