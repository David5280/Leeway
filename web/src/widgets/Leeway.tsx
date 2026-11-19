// The headline widget and the Overview's hero: how much room is left in the
// budget, what that is per day, how spending compares with the usual, and a
// ring of how much of the budget is used against how far through the period
// today is. Tapping it shows the math (lib/drills/budget.ts).

import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { Card } from '../components/design/Card'
import { HeroFigure } from '../components/design/HeroFigure'
import { Money } from '../components/design/Money'
import { ProgressRing } from '../components/design/ProgressRing'
import type { Status } from '../components/design/StatusPill'
import { Dot } from '../components/ui'
import { useApp } from '../lib/app'
import { leewayDrill, spendingUsual } from '../lib/drills/budget'
import { periodWord } from '../lib/format'
import type { WidgetProps } from './types'

/** Each goal's share held back this period, which the drill-down's math takes out. */
function SetAsideList({ setAsides }: { setAsides: Budget['setAsides'] }) {
  if (setAsides.length === 0) return null
  return (
    <ul className="plain-list small" aria-label="Set aside for goals">
      {setAsides.map((item) => (
        <li key={item.goalId} className="row-between">
          <span className="row" style={{ gap: 8 }}>
            <Dot color={item.color} />
            Set aside for {item.name}
          </span>
          <Money cents={item.amountCents} tone="muted" />
        </li>
      ))}
    </ul>
  )
}

function NoBudgets() {
  return (
    <Card static="empty" label="Your leeway" className="stack">
      <p className="eyebrow">Your leeway</p>
      <p style={{ fontSize: 17 }}>
        Give a few categories a budget and this shows how much room you have left.
      </p>
      <Link to="/budgets" className="btn primary tap" style={{ alignSelf: 'flex-start' }}>
        Set budgets
      </Link>
    </Card>
  )
}

/** The ring's tone: over the budget, used faster than the days, or fine. */
function usedStatus(used: number, through: number | null): Status {
  if (used > 100) return 'over'
  if (through !== null && used > through + 10) return 'watch'
  return 'ok'
}

/** What the room left means, in words: per day now, or plainly over. */
function Caption({ budget }: { budget: Budget }) {
  const { totals, period } = budget
  const daysToSpend = period.daysLeft + 1
  if (totals.leewayCents < 0) {
    return (
      <>
        <b>Over budget</b> by <Money cents={-totals.leewayCents} /> of{' '}
        <Money cents={totals.budgetedCents} />
      </>
    )
  }
  if (period.offset !== 0 || totals.safePerDayCents === null) {
    return (
      <>
        Left of <Money cents={totals.budgetedCents} />
      </>
    )
  }
  return (
    <>
      About{' '}
      <b>
        <Money cents={totals.safePerDayCents} />
      </b>{' '}
      a day for the next {daysToSpend} {daysToSpend === 1 ? 'day' : 'days'}, of{' '}
      <Money cents={totals.budgetedCents} />
    </>
  )
}

export function LeewayWidget({ budget }: WidgetProps) {
  const { money, settings } = useApp()
  const { totals, period } = budget
  if (totals.budgetedCents === 0) return <NoBudgets />
  const isCurrent = period.offset === 0
  const over = totals.leewayCents < 0
  const used = Math.round((totals.budgetedSpentCents / totals.budgetedCents) * 100)
  const through = isCurrent ? Math.round((period.daysElapsed / period.days) * 100) : null
  return (
    <Card drill={leewayDrill(budget, money)} label="Your leeway" className="hero stack">
      <HeroFigure
        label={over ? 'Over budget' : 'Left to spend'}
        cents={Math.abs(totals.leewayCents)}
        tone={over ? 'problem' : undefined}
        caption={<Caption budget={budget} />}
        usual={isCurrent ? spendingUsual(budget, periodWord(settings.period.kind)) : undefined}
        aside={
          <ProgressRing
            percent={used}
            label="Budget used"
            status={usedStatus(used, through)}
            size={76}
            marker={through}
          />
        }
      />
      <SetAsideList setAsides={budget.setAsides} />
      {through !== null && (
        <p className="small muted">
          {used}% of the budget used, {through}% of the way through the{' '}
          {periodWord(settings.period.kind)}.
        </p>
      )}
    </Card>
  )
}
