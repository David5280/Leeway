// The headline widget and the Overview's hero: how much room is left in the
// budget, held to what is safe to spend before payday (the server's
// spendable), what that is per day, and a ring of how much of the budget is
// used against how far through the period today is. When checking holds less
// than the budget has left, the cash leads and one line says why; it is red
// only for an overdraft or a shortfall. Tapping it shows the math
// (lib/drills/budget.ts).

import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { Card } from '../components/design/Card'
import { HeroFigure } from '../components/design/HeroFigure'
import { Money } from '../components/design/Money'
import { ProgressRing } from '../components/design/ProgressRing'
import type { Status } from '../components/design/StatusPill'
import { Dot } from '../components/ui'
import { useApp } from '../lib/app'
import { leewayDrill } from '../lib/drills/budget'
import { dayLabel, periodWord } from '../lib/format'
import type { WidgetProps } from './types'
import { paths } from '../routes'

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
      <Link to={paths.spending()} className="btn primary tap" style={{ alignSelf: 'flex-start' }}>
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

/** Within this many points of the calendar, spending reads as right on pace. */
const ON_PACE_POINTS = 2

/** How the share used compares with the share of the period gone, in plain words. */
export function paceWords(used: number, through: number): string {
  if (Math.abs(used - through) <= ON_PACE_POINTS) return "You're right on pace."
  return used < through ? "You're under pace." : "You're over pace."
}

/** The budget's room held to the cash, in this period only, while the cash is the lesser. */
function cashLead(budget: Budget): Budget['spendable'] {
  const { spendable, period, totals } = budget
  if (!spendable || period.offset !== 0 || totals.leewayCents < 0) return null
  return spendable.limitedBy === 'cash' ? spendable : null
}

/** The hero's label: over budget, the cash leading, or the budget's room. */
function heroLabel(over: boolean, cash: Budget['spendable']): string {
  if (over) return 'Over budget'
  return cash ? 'Safe to spend' : 'Left to spend'
}

/** The server's one line on the cash, red only for an overdraft or a shortfall. */
function CashNote({ budget }: { budget: Budget }) {
  const { spendable, period } = budget
  // It shows in this period whenever the server wrote one, over budget too.
  if (period.offset !== 0 || !spendable?.note) return null
  return <p className={`small ${spendable.problem ? 'over' : 'muted'}`}>{spendable.note}</p>
}

/** What the room left means, in words: per day now, or plainly over. */
function Caption({ budget }: { budget: Budget }) {
  const { settings } = useApp()
  const { totals, period } = budget
  const cash = cashLead(budget)
  if (cash) {
    return (
      <>
        About{' '}
        <b>
          <Money cents={cash.perDayCents} />
        </b>{' '}
        a day until {dayLabel(cash.payday, settings.locale)}
      </>
    )
  }
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
  const cash = cashLead(budget)
  return (
    <Card drill={leewayDrill(budget, money)} label="Your leeway" className="hero stack">
      <HeroFigure
        label={heroLabel(over, cash)}
        cents={cash ? cash.leadCents : Math.abs(totals.leewayCents)}
        tone={over || cash?.problem ? 'problem' : undefined}
        caption={<Caption budget={budget} />}
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
      <CashNote budget={budget} />
      <SetAsideList setAsides={budget.setAsides} />
      {through !== null && (
        // The ring shows the share used and marks today; this says what the two mean together.
        // Plain words, never red: the ring's color already carries any warning.
        <p className="small muted">
          The mark is today, {through}% of the way through the {periodWord(settings.period.kind)}.
          {/* Over budget, the figure above already says so; pace would only say it again. */}
          {!over && ` ${paceWords(used, through)}`}
        </p>
      )}
    </Card>
  )
}
