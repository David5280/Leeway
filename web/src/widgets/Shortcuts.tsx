// Optional Home cards that bring a page a tap deeper one tap closer: spending
// over time and top merchants (Spending's Trends row) and debt payoff (a row
// on Wealth). Each is a summary that opens its page, never a second place to
// act, and none is on Home until the owner adds it.

import { useAction } from '../api/hooks'
import { Money } from '../components/design/Money'
import { useApp } from '../lib/app'
import { monthYear, periodWord } from '../lib/format'
import { durationText } from '../pages/plan/text'
import { paths } from '../routes'
import { TabCard, TabCardWaiting } from './TabCard'

/** Periods the spending card reads: this one and enough before it for a usual amount. */
const TREND_PERIODS = 6

/** Spending this period, beside what an earlier period usually came to. */
export function TrendsWidget() {
  const { settings } = useApp()
  const trends = useAction('get_trends', { periods: TREND_PERIODS })
  const name = 'Spending over time'
  if (!trends.data) return <TabCardWaiting name={name} error={trends.error} />
  const word = periodWord(settings.period.kind)
  const current = trends.data.at(-1)
  const earlier = trends.data.slice(0, -1)
  // The average of the periods before this one: this one is not over yet.
  const usual =
    earlier.length > 0
      ? Math.round(earlier.reduce((sum, period) => sum + period.spentCents, 0) / earlier.length)
      : null
  return (
    <TabCard
      name={name}
      to={paths.spendingOverTime()}
      figure={<Money cents={current?.spentCents ?? 0} />}
    >
      <span className="muted">
        So far this {word}
        {usual !== null && (
          <>
            , usually <Money cents={usual} />
          </>
        )}
      </span>
    </TabCard>
  )
}

/** Where the most went this period: the biggest merchant and what it took. */
export function MerchantsWidget() {
  const merchants = useAction('top_merchants', { offset: 0, limit: 1 })
  const name = 'Top merchants'
  if (!merchants.data) return <TabCardWaiting name={name} error={merchants.error} />
  const top = merchants.data[0]
  if (!top) {
    return (
      <TabCard name={name} to={paths.topMerchants()} figure="Nothing yet">
        <span className="muted">No spending yet this period</span>
      </TabCard>
    )
  }
  return (
    <TabCard name={name} to={paths.topMerchants()} figure={<Money cents={top.spentCents} />}>
      <span className="muted ellipsis">The most went to {top.merchant}</span>
    </TabCard>
  )
}

/** When the debts are gone, paying the minimums the cheapest way. */
export function DebtsWidget() {
  const { settings } = useApp()
  const plans = useAction('plan_debt_payoff', { extraCents: 0 })
  const name = 'Debt payoff'
  if (!plans.data) return <TabCardWaiting name={name} error={plans.error} />
  const plan = plans.data.avalanche
  if (plan.debts.length === 0) {
    const missing = plans.data.needsDetails.length > 0
    return (
      <TabCard name={name} to={paths.debts()} figure={missing ? 'Rates needed' : 'No debts'}>
        <span className="muted">
          {missing ? 'Add interest rates to see when debts are paid off' : 'Nothing owed'}
        </span>
      </TabCard>
    )
  }
  return (
    <TabCard
      name={name}
      to={paths.debts()}
      figure={
        plan.debtFreeDate ? monthYear(plan.debtFreeDate, settings.locale) : 'Not at these payments'
      }
    >
      <span className="muted">
        Debt free in {durationText(plan.months).toLowerCase()}, paying{' '}
        <Money cents={plan.monthlyPaymentCents} /> a month
      </span>
    </TabCard>
  )
}
