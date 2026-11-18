// The pace chart's rules, free of React: its axis, what it labels and where
// its plot sits, so each can be read and tested on its own.

import type { Output } from '../../api/client'
import { niceTicks, textWidth } from '../../lib/chartScale'

export type Pace = Output<'get_spending_pace'>

/**
 * The value axis for a pace chart. A wild early projection (a big purchase on
 * day one) would flatten everything else, so the axis stops at 1.6 times the
 * larger of budget and spending; the projection line runs off the top instead.
 */
export function paceAxis(budgetCents: number, spentCents: number, projectedCents: number) {
  const base = Math.max(budgetCents, spentCents)
  const projection = base > 0 ? Math.min(projectedCents, base * 1.6) : projectedCents
  // A little headroom so the highest line never sits on the top gridline.
  return niceTicks(0, Math.max(base, projection) * 1.04, 5)
}

/** The steady-pace amount by day `index`: the budget spread evenly over the period. */
export function steadyAt(budgetCents: number, index: number, days: number): number {
  return Math.round((budgetCents * (index + 1)) / Math.max(1, days))
}

/** Where spending stands: the last day with data and whether there is a projection to draw. */
export function paceState(pace: Pace, isCurrent: boolean) {
  const lastIndex = pace.cumulative.length - 1
  return {
    lastIndex,
    spentCents: pace.cumulative.at(-1)?.cents ?? 0,
    // A finished period, or one whose last day has data, has nothing left to project.
    projecting: isCurrent && lastIndex >= 0 && lastIndex < pace.days - 1,
  }
}

export interface EndLabelSpec {
  name: string
  cents: number
  tone: 'muted' | 'accent'
}

/**
 * The labels at the right-hand ends of the lines, in place of a legend: the
 * budget, and either where spending is heading or, for a finished period,
 * where it ended.
 */
export function paceEndLabels(pace: Pace, state: ReturnType<typeof paceState>): EndLabelSpec[] {
  const labels: EndLabelSpec[] = []
  if (pace.budgetCents > 0) labels.push({ name: 'Budget', cents: pace.budgetCents, tone: 'muted' })
  if (state.projecting) {
    labels.push({ name: 'Projected', cents: pace.projectedCents, tone: 'accent' })
  } else if (state.lastIndex >= 0) {
    labels.push({ name: 'Spent', cents: state.spentCents, tone: 'accent' })
  }
  return labels
}

/**
 * The plot's edges inside a chart `width` pixels wide: a gutter on the left
 * for the value labels and one on the right for the line-end labels.
 */
export function paceFrame(width: number, tickLabels: string[], endLabels: string[]) {
  const height = width < 420 ? 210 : 250
  const widest = (labels: string[], size: number) =>
    Math.max(0, ...labels.map((label) => textWidth(label, size)))
  return {
    height,
    left: widest(tickLabels, 12) + 12,
    right: width - Math.max(72, widest(endLabels, 13) + 14),
    // Room above the plot for "Today", and below it for the dates.
    top: 26,
    bottom: height - 30,
  }
}

/** The first and last date labels hug the plot's edges so they never spill past them. */
export function edgeAnchor(index: number, days: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start'
  if (index === days - 1) return 'end'
  return 'middle'
}
