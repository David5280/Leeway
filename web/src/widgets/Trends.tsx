// Spending per period over the last six, against the total budget.

import { useAction } from '../api/hooks'
import { PeriodBars } from '../components/charts'
import { Card } from '../components/ui'
import { useApp } from '../lib/app'
import { periodBarLabel, periodLabel } from '../lib/format'

export function TrendsWidget() {
  const { settings } = useApp()
  const trends = useAction('get_trends', { periods: 6 })
  const budget = useAction('get_budget', { offset: 0 })
  const first = trends.data?.at(0)
  const last = trends.data?.at(-1)
  return (
    <Card label="Spending by period" className="stack-sm">
      <h2>Spending over time</h2>
      {trends.data && (
        <PeriodBars
          label="Spending by period"
          color="var(--accent)"
          budgetCents={budget.data?.totals.budgetedCents || null}
          bars={trends.data.map((p) => ({
            label: periodBarLabel(p.start, settings.period.kind, settings.locale),
            cents: p.spentCents,
            current: p.offset === 0,
          }))}
        />
      )}
      {first && last && (
        <span className="small muted">{periodLabel(first.start, last.end, settings.locale)}</span>
      )}
    </Card>
  )
}
