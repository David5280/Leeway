// What went out in each budget period, oldest first, as get_trends returns
// them, drawn against today's total budget: Home's Spending over time card and
// the Spending over time page a tap deeper from Spending.

import type { Output } from '../../api/client'
import { useApp } from '../../lib/app'
import { periodBarLabel } from '../../lib/format'
import { PeriodBars } from './PeriodBars'

export type Trends = Output<'get_trends'>

export function SpendingBars({
  trends,
  budgetCents,
}: {
  trends: Trends
  /** The budgets' total now, drawn as the line to stay under; null with none set. */
  budgetCents: number | null
}) {
  const { settings } = useApp()
  return (
    <PeriodBars
      label="Spending by period"
      overIsProblem
      budgetCents={budgetCents}
      bars={trends.map((period) => ({
        label: periodBarLabel(period.start, settings.period.kind, settings.locale),
        cents: period.spentCents,
        current: period.offset === 0,
      }))}
    />
  )
}
