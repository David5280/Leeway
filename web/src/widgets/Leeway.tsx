// The headline widget: how much room is left in the budget, and per day.
// Goals set aside from the budget are held back from that room and listed.

import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { Card, Dot, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

/** Each goal's share held back this period, linked to the goals it is for. */
function SetAsideList({ setAsides }: { setAsides: Budget['setAsides'] }) {
  const { money } = useApp()
  if (setAsides.length === 0) return null
  return (
    <ul className="plain-list small" aria-label="Set aside for goals">
      {setAsides.map((item) => (
        <li key={item.goalId} className="row-between">
          <Link to="/plan/goals" className="row tap" style={{ gap: 8, color: 'inherit' }}>
            <Dot color={item.color} />
            Set aside for {item.name}
          </Link>
          <span className="num muted">{money(item.amountCents)}</span>
        </li>
      ))}
    </ul>
  )
}

function NoBudgets() {
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

export function LeewayWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const { totals, period } = budget
  const isCurrent = budget.period.offset === 0
  if (totals.budgetedCents === 0) return <NoBudgets />
  // The room left is what the budgets have left, less what goals hold back.
  const leeway = totals.leewayCents
  const used = (totals.budgetedSpentCents / totals.budgetedCents) * 100
  const held = (totals.setAsideCents / totals.budgetedCents) * 100
  const daysToSpend = period.daysLeft + 1
  return (
    <Card label="Your leeway" className="stack">
      <p className="eyebrow">Your leeway</p>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <span className={`num big-number ${leeway < 0 ? 'over' : ''}`}>
          {money(Math.abs(leeway))}
        </span>
        <span className="muted" style={{ fontSize: 16 }}>
          {leeway < 0 ? 'over' : 'left of'} {money(totals.budgetedCents)}
          {totals.setAsideCents > 0 && `, after ${money(totals.setAsideCents)} set aside`}
        </span>
      </div>
      {isCurrent && totals.safePerDayCents !== null && (
        <p style={{ fontSize: 17 }}>
          {leeway > 0 ? (
            <>
              About <strong className="num">{money(totals.safePerDayCents)}</strong> a day for the
              next {daysToSpend} {daysToSpend === 1 ? 'day' : 'days'}.
            </>
          ) : (
            'Nothing left to spend this period.'
          )}
        </p>
      )}
      <SetAsideList setAsides={budget.setAsides} />
      {/* Pinned to the bottom, so the card reads well when its column stretches it. */}
      <div className="stack-sm" style={{ marginTop: 'auto' }}>
        <Progress
          thick
          percent={used}
          reserved={held}
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
