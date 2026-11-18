// Dashboard widgets for the Plan screen: cash until payday, bills, goals, debts and net worth.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { LineChart } from '../components/charts/LineChart'
import { Card, ErrorNote, Loading, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import { monthYear, shortDate } from '../lib/format'
import { CashFlowSummary } from '../pages/plan/CashFlow'
import { billStatus, durationText } from '../pages/plan/text'

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

/** Shows the error or a spinner until there is data. */
function Pending({ error }: { error: unknown }) {
  return error ? <ErrorNote error={error} /> : <Loading />
}

export function CashFlowWidget() {
  return (
    <Card label="Until payday" className="stack-sm">
      <Header title="Until payday" to="/plan" link="Plan" />
      <CashFlowSummary compact />
    </Card>
  )
}

/** The next few bills, soonest first. */
export function BillsWidget() {
  const { exact, settings } = useApp()
  const bills = useAction('list_bills')
  return (
    <Card label="Bills" className="stack-sm">
      <Header title="Bills" to="/plan/bills" link="All bills" />
      {!bills.data && <Pending error={bills.error} />}
      {bills.data?.bills.length === 0 && <p className="empty">No bills tracked yet.</p>}
      {bills.data?.bills.slice(0, 5).map((bill) => {
        const status = billStatus(bill, settings.locale)
        return (
          <div key={bill.id} className="list-row">
            <span className="grow">{bill.name}</span>
            <span className={`small ${status.tone || 'muted'}`}>{status.text}</span>
            <span className="num">{exact(bill.amountCents)}</span>
          </div>
        )
      })}
    </Card>
  )
}

export function GoalsWidget() {
  const { money } = useApp()
  const goals = useAction('list_goals')
  return (
    <Card label="Goals" className="stack-sm">
      <Header title="Goals" to="/plan/goals" link="All goals" />
      {!goals.data && <Pending error={goals.error} />}
      {goals.data?.length === 0 && <p className="empty">No savings goals yet.</p>}
      {goals.data?.slice(0, 4).map((goal) => (
        <div key={goal.id} className="stack-sm" style={{ gap: 4 }}>
          <div className="row-between small">
            <span>{goal.name}</span>
            <span className="num muted">
              {money(goal.currentCents)} of {money(goal.targetCents)}
            </span>
          </div>
          <Progress percent={goal.percent} color={goal.color} label={`${goal.name} progress`} />
        </div>
      ))}
    </Card>
  )
}

/** When the debts are gone with the cheapest strategy and no extra payment. */
export function DebtsWidget() {
  const { money, settings } = useApp()
  const plans = useAction('plan_debt_payoff', { extraCents: 0 })
  const plan = plans.data?.avalanche
  const owed = plans.data?.debts.reduce((sum, d) => sum + d.balanceCents, 0) ?? 0
  return (
    <Card label="Debt payoff" className="stack-sm">
      <Header title="Debt payoff" to="/plan/debts" link="Plan it" />
      {!plans.data && <Pending error={plans.error} />}
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
            <span className="num">{money(plan.monthlyPaymentCents)}</span> a month on{' '}
            <span className="num">{money(owed)}</span> owed.
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
    <Card label="Net worth" className="stack-sm">
      <Header title="Net worth" to="/plan/net-worth" link="Details" />
      {!worth.data && <Pending error={worth.error} />}
      {worth.data && (
        <span className={`num mid-number ${worth.data.netWorthCents < 0 ? 'over' : ''}`}>
          {money(worth.data.netWorthCents)}
        </span>
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
