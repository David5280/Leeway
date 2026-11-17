// The headline widget: how much room is left in the budget, and per day.

import { Link } from 'react-router-dom'
import { Card, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

export function LeewayWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const { totals, period } = budget
  const isCurrent = budget.period.offset === 0
  if (totals.budgetedCents === 0) {
    return (
      <Card label="Your leeway" className="stack">
        <p className="eyebrow">Your leeway</p>
        <p style={{ fontSize: 17 }}>
          Give a few categories a budget and this shows how much room you have left.
        </p>
        <Link to="/budgets" className="btn primary" style={{ alignSelf: 'flex-start' }}>
          Set budgets
        </Link>
      </Card>
    )
  }
  const used = (totals.budgetedSpentCents / totals.budgetedCents) * 100
  const daysToSpend = period.daysLeft + 1
  return (
    <Card label="Your leeway" className="stack">
      <p className="eyebrow">Your leeway</p>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <span className={`num big-number ${totals.leftCents < 0 ? 'over' : ''}`}>
          {money(Math.abs(totals.leftCents))}
        </span>
        <span className="muted" style={{ fontSize: 16 }}>
          {totals.leftCents < 0 ? 'over' : 'left of'} {money(totals.budgetedCents)}
        </span>
      </div>
      {isCurrent && totals.safePerDayCents !== null && (
        <p style={{ fontSize: 17 }}>
          {totals.leftCents > 0 ? (
            <>
              About <strong className="num">{money(totals.safePerDayCents)}</strong> a day for the
              next {daysToSpend} {daysToSpend === 1 ? 'day' : 'days'}.
            </>
          ) : (
            'Nothing left to spend this period.'
          )}
        </p>
      )}
      <div className="stack-sm">
        <Progress
          thick
          percent={used}
          color={used > 100 ? 'var(--over-fill)' : 'var(--accent)'}
          marker={isCurrent ? (period.daysElapsed / period.days) * 100 : null}
          label="Budget used"
        />
        <div className="row-between small muted">
          <span>
            <span className="num">{money(totals.budgetedSpentCents)}</span> spent,{' '}
            {Math.round(used)}%
          </span>
          {isCurrent && (
            <span className="hide-sm">Marker: where steady spending would be today</span>
          )}
        </div>
      </div>
    </Card>
  )
}
