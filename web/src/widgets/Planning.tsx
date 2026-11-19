// Dashboard widgets for the Plan screen: cash until payday, bills, goals, debts and net worth.

import { Card } from '../components/design/Card'
import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { LineChart } from '../components/charts/LineChart'
import { LoadingOrError, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import { monthYear, periodWord, shortDate } from '../lib/format'
import { shortPlan } from '../lib/goalText'
import { CashFlowSummary } from '../pages/plan/CashFlow'
import { billStatus, durationText } from '../pages/plan/text'
import { Money } from '../components/design/Money'

/** A widget's title row, with a link to its full section on the Plan screen. */
function Header({ title, to, link }: { title: string; to: string; link: string }) {
  return (
    <div className="row-between">
      <h2>{title}</h2>
      <Link to={to} className="linkbtn">
        {link}
      </Link>
    </div>
  )
}

export function CashFlowWidget() {
  return (
    <Card static="pending" label="Until payday" className="stack-sm">
      <Header title="Until payday" to="/plan" link="Plan" />
      <CashFlowSummary compact />
    </Card>
  )
}

/** The next few bills, soonest first. */
export function BillsWidget() {
  const { settings } = useApp()
  const bills = useAction('list_bills')
  return (
    <Card static="list" label="Bills" className="stack-sm">
      <Header title="Bills" to="/plan/bills" link="All bills" />
      {!bills.data && <LoadingOrError error={bills.error} />}
      {bills.data?.bills.length === 0 && <p className="empty">No bills tracked yet.</p>}
      {bills.data?.bills.slice(0, 5).map((bill) => {
        const status = billStatus(bill, settings.locale)
        return (
          <div key={bill.id} className="list-row">
            <span className="grow">{bill.name}</span>
            <span className={`small ${status.tone || 'muted'}`}>{status.text}</span>
            <Money cents={bill.amountCents} precision="cents" />
          </div>
        )
      })}
    </Card>
  )
}

/** Each goal's progress, what it needs per budget period, and whether it is on track. */
export function GoalsWidget() {
  const { money, settings } = useApp()
  const goals = useAction('list_goals')
  const word = periodWord(settings.period.kind)
  return (
    <Card static="pending" label="Goals" className="stack-sm">
      <Header title="Goals" to="/plan/goals" link="All goals" />
      {!goals.data && <LoadingOrError error={goals.error} />}
      {goals.data?.length === 0 && <p className="empty">No savings goals yet.</p>}
      {goals.data?.slice(0, 4).map((goal) => {
        const plan = shortPlan(goal, money, word)
        return (
          <div key={goal.id} className="stack-sm" style={{ gap: 4 }}>
            <div className="row-between small">
              <span>{goal.name}</span>
              <span className="num muted">
                <Money cents={goal.currentCents} /> of <Money cents={goal.targetCents} />
              </span>
            </div>
            <Progress
              percent={goal.percent}
              color={goal.color}
              aria-label={`${goal.name} progress`}
            />
            <span className={`small ${plan.tone || 'muted'}`}>{plan.text}</span>
          </div>
        )
      })}
      {goals.data && (
        <Link to="/plan/goals?new=purchase" className="linkbtn small" style={{ marginTop: 'auto' }}>
          Save for a purchase
        </Link>
      )}
    </Card>
  )
}

/** When the debts are gone with the cheapest strategy and no extra payment. */
export function DebtsWidget() {
  const { settings } = useApp()
  const plans = useAction('plan_debt_payoff', { extraCents: 0 })
  const plan = plans.data?.avalanche
  const owed = plans.data?.debts.reduce((sum, d) => sum + d.balanceCents, 0) ?? 0
  return (
    <Card static="pending" label="Debt payoff" className="stack-sm">
      <Header title="Debt payoff" to="/plan/debts" link="Plan it" />
      {!plans.data && <LoadingOrError error={plans.error} />}
      {plans.data && !plan?.debts.length && (
        <p className="small muted">
          {plans.data.needsDetails.length > 0
            ? 'Add interest rates to your cards and loans to see when they are paid off.'
            : 'No debts with a balance.'}
        </p>
      )}
      {plan && plan.debts.length > 0 && (
        <>
          <span className="num mid-number">
            {plan.debtFreeDate
              ? monthYear(plan.debtFreeDate, settings.locale)
              : 'Not at these payments'}
          </span>
          <span className="small muted">
            Debt free in {durationText(plan.months).toLowerCase()}, paying{' '}
            <Money cents={plan.monthlyPaymentCents} /> a month on <Money cents={owed} /> owed.
          </span>
        </>
      )}
    </Card>
  )
}

export function NetWorthWidget() {
  const { money, settings } = useApp()
  const worth = useAction('get_net_worth', { days: 365 })
  const points = worth.data?.history.map((p) => ({ date: p.date, cents: p.netWorthCents })) ?? []
  return (
    <Card static="pending" label="Net worth" className="stack-sm">
      <Header title="Net worth" to="/plan/net-worth" link="Details" />
      {!worth.data && <LoadingOrError error={worth.error} />}
      {worth.data && (
        <Money
          cents={worth.data.netWorthCents}
          tone={worth.data.netWorthCents < 0 ? 'problem' : undefined}
          className="mid-number"
        />
      )}
      {points.length > 1 && (
        <>
          <LineChart
            compact
            points={points}
            label="Net worth over the last year"
            description={`From ${money(points[0]!.cents)} on ${shortDate(points[0]!.date, settings.locale)} to ${money(points.at(-1)!.cents)} on ${shortDate(points.at(-1)!.date, settings.locale)}.`}
          />
          <span className="small muted row-between">
            <span>{shortDate(points[0]!.date, settings.locale)}</span>
            <span>{shortDate(points.at(-1)!.date, settings.locale)}</span>
          </span>
        </>
      )}
    </Card>
  )
}
