// Home's four tab cards, one line from each tab in the map's order: cash to
// payday (Payday), spending pace (Spending), your top goal (Goals) and net
// worth (Wealth). Each repeats its tab's figure on purpose and opens that tab,
// where the figure is explained and acted on. What you can spend is Leeway's
// alone, so none of these says money left.

import type { CashFlow, Goal, SpendingPace } from '../api/client'
import { useAction } from '../api/hooks'
import { Money } from '../components/design/Money'
import { StatusPill } from '../components/design/StatusPill'
import { WorthChangeLine } from '../components/WorthChange'
import { useApp } from '../lib/app'
import { dayLabel, periodWord } from '../lib/format'
import { shortPlan } from '../lib/goalText'
import { worthChange } from '../lib/worth'
import { paths } from '../routes'
import { TabCard, TabCardWaiting } from './TabCard'

/** Payday's card: what the bills before payday come to, and whether the cash covers them. */
export function CashToPaydayCard() {
  const cash = useAction('get_cash_flow')
  const name = 'Cash to payday'
  if (!cash.data) return <TabCardWaiting name={name} error={cash.error} />
  return (
    <TabCard name={name} to={paths.payday()} figure={<Money cents={cash.data.billsDueCents} />}>
      <CashStatus flow={cash.data} />
    </TabCard>
  )
}

/** Whether the cash in checking covers the bills before payday, and when payday is. */
function CashStatus({ flow }: { flow: CashFlow }) {
  const { settings } = useApp()
  const payday = `payday ${dayLabel(flow.nextPayday, settings.locale)}`
  // No checking balance yet: unknown, never "covered" and never short.
  if (!flow.cashKnown) return <span className="muted">Bills before {payday}</span>
  if (flow.shortfallCents > 0) {
    return (
      <>
        <StatusPill status="over" label="Short" />
        <span className="muted">
          by <Money cents={flow.shortfallCents} /> before {payday}
        </span>
      </>
    )
  }
  return (
    <>
      <StatusPill status="ok" label="Covered" />
      <span className="muted">Bills before {payday}</span>
    </>
  )
}

/** Within this many points of the calendar, spending reads as on pace. */
const ON_PACE_POINTS = 2

/** Spending's card: how much of the flexible budget is used, and whether that is on pace. */
export function SpendingPaceCard() {
  const pace = useAction('get_spending_pace', { offset: 0 })
  const name = 'Spending pace'
  if (!pace.data) return <TabCardWaiting name={name} error={pace.error} />
  // With no category following pace there is nothing to measure yet.
  if (pace.data.categoryIds.length === 0 || pace.data.budgetCents === 0) {
    return (
      <TabCard name={name} to={paths.spending()} figure="Not set up">
        <span className="muted">Turn on pace for a budget to follow it</span>
      </TabCard>
    )
  }
  const used = paceUsed(pace.data)
  return (
    <TabCard name={name} to={paths.spending()} figure={`${used}% used`}>
      <PaceStatus pace={pace.data} />
      <span className="muted">
        of <Money cents={pace.data.budgetCents} />
      </span>
    </TabCard>
  )
}

/** The share of the followed budget spent so far, in whole percent. */
export function paceUsed(pace: SpendingPace): number {
  const spent = pace.cumulative.at(-1)?.cents ?? 0
  return Math.round((spent / pace.budgetCents) * 100)
}

/** On pace, or heading over: where the projection lands against the budget. */
function PaceStatus({ pace }: { pace: SpendingPace }) {
  const over = pace.projectedCents - pace.budgetCents
  // A projection within a couple of points of the budget is on pace, not over.
  if (over <= (pace.budgetCents * ON_PACE_POINTS) / 100) {
    return <StatusPill status="ok" label="On pace" />
  }
  return <StatusPill status="watch" label="Ahead of pace" />
}

/**
 * The goal at the top of the goal order that is still being saved for, or
 * the first goal when every one is done.
 */
export function topGoal(goals: Goal[]): Goal | undefined {
  const saving = (goal: Goal) => goal.status === 'in_progress' || goal.status === 'past_due'
  return goals.find(saving) ?? goals[0]
}

/** Goals' card: the top goal, how far along it is, and whether it is on track. */
export function TopGoalCard() {
  const { money, settings } = useApp()
  const goals = useAction('list_goals')
  const name = 'Your top goal'
  if (!goals.data) return <TabCardWaiting name={name} error={goals.error} />
  const goal = topGoal(goals.data)
  if (!goal) {
    return (
      <TabCard name={name} to={paths.goals()} figure="No goals yet">
        <span className="muted">Start one on Goals</span>
      </TabCard>
    )
  }
  const plan = shortPlan(goal, money, periodWord(settings.period.kind))
  return (
    <TabCard name={name} to={paths.goals()} figure={`${goal.percent}%`}>
      <span className="ellipsis">{goal.name}</span>
      <span className={plan.tone || 'muted'}>{plan.text}</span>
    </TabCard>
  )
}

/** Wealth's card: net worth, and how far it moved over the last year. */
export function NetWorthCard() {
  const worth = useAction('get_net_worth', { days: 365 })
  const name = 'Net worth'
  if (!worth.data) return <TabCardWaiting name={name} error={worth.error} />
  const change = worthChange(worth.data)
  return (
    <TabCard
      name={name}
      to={paths.wealth()}
      figure={
        <Money
          cents={worth.data.netWorthCents}
          tone={worth.data.netWorthCents < 0 ? 'problem' : undefined}
        />
      }
    >
      {change && <WorthChangeLine change={change} />}
    </TabCard>
  )
}
