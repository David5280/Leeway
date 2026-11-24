// Dashboard widgets from the Plan screen: cash until payday, bills, goals,
// debts and net worth. A card with a figure opens the math behind it
// (lib/drills/plan.ts); the lists open each row's own page.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { LineChart } from '../components/charts/LineChart'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { LoadingOrError, Progress, type IconName } from '../components/ui'
import { useApp } from '../lib/app'
import { cashFlowDrill, debtsDrill, netWorthDrill } from '../lib/drills/plan'
import { dayLabel, longDate, monthYear, periodWord, shortDate } from '../lib/format'
import { isoDaysAgo } from '../lib/dates'
import { shortPlan } from '../lib/goalText'
import { CashFacts } from '../pages/plan/CashFlow'
import { billStatus, durationText } from '../pages/plan/text'
import { historyNote, worthChange } from '../lib/worth'
import { WorthChangeLine } from '../components/WorthChange'
import { paths } from '../routes'

/** A widget before it has a figure to explain: its head, and loading or the error. */
function Waiting({
  label,
  icon,
  title,
  error,
}: {
  label: string
  icon: IconName
  title: string
  error: Error | null
}) {
  return (
    <Card static="empty" label={label} className="stack-sm">
      <SectionHead icon={icon} title={title} />
      <LoadingOrError error={error} />
    </Card>
  )
}

export function CashFlowWidget() {
  const { settings } = useApp()
  const cash = useAction('get_cash_flow')
  const title = 'Will the cash last until payday?'
  if (!cash.data) {
    return <Waiting label="Until payday" icon="wallet" title={title} error={cash.error} />
  }
  const date = (iso: string) => dayLabel(iso, settings.locale)
  return (
    <Card drill={cashFlowDrill(cash.data, date)} label="Until payday" className="stack-sm">
      <SectionHead icon="wallet" title={title} />
      <CashFacts flow={cash.data} />
    </Card>
  )
}

/** The next few bills, soonest first, each opening the bills page. */
export function BillsWidget() {
  const { settings } = useApp()
  const bills = useAction('list_bills')
  return (
    <Card static="list" label="Bills" className="stack-sm">
      <SectionHead icon="receipt" title="Bills" />
      {!bills.data && <LoadingOrError error={bills.error} />}
      {bills.data?.bills.length === 0 && <p className="empty">No bills tracked yet.</p>}
      {bills.data?.bills.slice(0, 5).map((bill) => {
        const status = billStatus(bill, settings.locale)
        return (
          <Link key={bill.id} to={paths.bills()} className="list-row clickrow">
            <span className="grow">{bill.name}</span>
            <span className={`small ${status.tone || 'muted'}`}>{status.text}</span>
            <Money cents={bill.amountCents} precision="cents" />
          </Link>
        )
      })}
    </Card>
  )
}

/** Each goal's progress and whether it is on track, each opening the goals page. */
export function GoalsWidget() {
  const { money, settings } = useApp()
  const goals = useAction('list_goals')
  const word = periodWord(settings.period.kind)
  return (
    <Card static="list" label="Goals" className="stack-sm">
      <SectionHead icon="target" title="Goals" />
      {!goals.data && <LoadingOrError error={goals.error} />}
      {goals.data?.length === 0 && <p className="empty">No savings goals yet.</p>}
      {goals.data?.slice(0, 4).map((goal) => {
        const plan = shortPlan(goal, money, word)
        return (
          <Link key={goal.id} to={paths.goals()} className="clickrow">
            <span className="row-between small">
              <span>{goal.name}</span>
              <span className="num muted">
                <Money cents={goal.currentCents} /> of <Money cents={goal.targetCents} />
              </span>
            </span>
            <Progress
              percent={goal.percent}
              color={goal.color}
              aria-label={`${goal.name} progress`}
            />
            <span className={`small ${plan.tone || 'muted'}`}>{plan.text}</span>
          </Link>
        )
      })}
      {goals.data && (
        <Link to={paths.goals({ new: 'purchase' })} className="linkbtn small tap">
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
  const title = 'When will the debts be gone?'
  if (!plans.data) {
    return <Waiting label="Debt payoff" icon="loan" title={title} error={plans.error} />
  }
  const plan = plans.data.avalanche
  if (plan.debts.length === 0) {
    return (
      <Card static="words" label="Debt payoff" className="stack-sm">
        <SectionHead icon="loan" title={title} />
        <p className="small muted">
          {plans.data.needsDetails.length > 0
            ? 'Add interest rates to your cards and loans to see when they are paid off.'
            : 'No debts with a balance.'}
        </p>
      </Card>
    )
  }
  const owed = plans.data.debts.reduce((sum, debt) => sum + debt.balanceCents, 0)
  return (
    <Card drill={debtsDrill(plans.data, durationText)} label="Debt payoff" className="stack-sm">
      <SectionHead icon="loan" title={title} />
      <span className="num mid-number">
        {plan.debtFreeDate
          ? monthYear(plan.debtFreeDate, settings.locale)
          : 'Not at these payments'}
      </span>
      <span className="small muted">
        Debt free in {durationText(plan.months).toLowerCase()}, paying{' '}
        <Money cents={plan.monthlyPaymentCents} /> a month on <Money cents={owed} /> owed.
      </span>
    </Card>
  )
}

/** "Is your net worth growing?": the figure, how far it has come this year, and its line. */
export function NetWorthWidget() {
  const { money, settings } = useApp()
  const worth = useAction('get_net_worth', { days: 365 })
  const title = 'Is your net worth growing?'
  if (!worth.data) {
    return <Waiting label="Net worth" icon="growth" title={title} error={worth.error} />
  }
  const points = worth.data.history.map((p) => ({ date: p.date, cents: p.netWorthCents }))
  const change = worthChange(worth.data)
  const note = historyNote(worth.data, isoDaysAgo(365, settings.timeZone), (iso) =>
    longDate(iso, settings.locale),
  )
  return (
    <Card drill={netWorthDrill(worth.data)} label="Net worth" className="stack-sm">
      <SectionHead icon="growth" title={title} />
      <Money
        cents={worth.data.netWorthCents}
        tone={worth.data.netWorthCents < 0 ? 'problem' : undefined}
        className="mid-number"
      />
      {change && (
        <>
          <WorthChangeLine change={change} />
          <LineChart
            compact
            points={points}
            label="Net worth over the last year"
            description={`From ${money(change.fromCents)} on ${shortDate(change.fromDate, settings.locale)} to ${money(worth.data.netWorthCents)} today.${note ? ` ${note}` : ''}`}
          />
          {note && <p className="small muted">{note}</p>}
        </>
      )}
    </Card>
  )
}
