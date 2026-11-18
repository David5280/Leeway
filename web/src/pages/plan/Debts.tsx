// Debt payoff: the terms of each card and loan, and how fast each strategy clears them.

import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import type { DebtPlans } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card, ErrorNote, Loading, Segmented, Setting } from '../../components/ui'
import { isOwed } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { monthYear, parseMoney } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { DebtTerms } from './DebtTerms'
import { durationText } from './text'

type Strategy = 'avalanche' | 'snowball' | 'minimumsOnly'

const STRATEGIES = [
  {
    value: 'avalanche',
    label: 'Avalanche',
    about: 'Extra money goes to the highest interest rate first. Costs the least.',
  },
  {
    value: 'snowball',
    label: 'Snowball',
    about: 'Extra money goes to the smallest balance first, for quicker wins.',
  },
  { value: 'minimumsOnly', label: 'Minimums only', about: 'Only the required payments.' },
] as const

/** One strategy's result: when it is all paid off and the interest it costs. */
function StrategyTile({ plans, strategy }: { plans: DebtPlans; strategy: Strategy }) {
  const { money, settings } = useApp()
  const plan = plans[strategy]
  const { label } = STRATEGIES.find((s) => s.value === strategy)!
  return (
    <div className="span-4 stack-sm" role="group" aria-label={`${label} plan`}>
      <span className="eyebrow">{label}</span>
      <span className="num mid-number">
        {plan.debtFreeDate ? monthYear(plan.debtFreeDate, settings.locale) : 'Never'}
      </span>
      <span className="small muted">
        {durationText(plan.months)}, <span className="num">{money(plan.totalInterestCents)}</span>{' '}
        interest
      </span>
    </div>
  )
}

function PayoffPlan({ extraCents }: { extraCents: number }) {
  const { money } = useApp()
  const [strategy, setStrategy] = useState<Strategy>('avalanche')
  const plans = useAction('plan_debt_payoff', { extraCents }, { placeholderData: keepPreviousData })
  if (!plans.data) return plans.error ? <ErrorNote error={plans.error} /> : <Loading />
  const data = plans.data
  if (data.debts.length === 0) {
    return <p className="empty">Add an interest rate for a debt above to see a plan.</p>
  }
  const plan = data[strategy]
  // Soonest paid off first; a debt that never clears goes last.
  const order = [...plan.debts].sort((a, b) => (a.months ?? Infinity) - (b.months ?? Infinity))
  return (
    <>
      <div className="grid">
        {STRATEGIES.map((s) => (
          <StrategyTile key={s.value} plans={data} strategy={s.value} />
        ))}
      </div>
      <span className="small muted">
        Paying <span className="num">{money(plan.monthlyPaymentCents)}</span> a month in all.
      </span>
      <Segmented label="Strategy" value={strategy} options={STRATEGIES} onChange={setStrategy} />
      <span className="small">{STRATEGIES.find((s) => s.value === strategy)!.about}</span>
      {order.map((debt, index) => (
        <div key={debt.id} className="list-row">
          <span className="num small muted" style={{ width: 20 }}>
            {index + 1}
          </span>
          <span className="grow">{debt.name}</span>
          <span className="small muted">{durationText(debt.months)}</span>
        </div>
      ))}
      {data.needsDetails.length > 0 && (
        <p className="notice">
          Left out until they have terms: {data.needsDetails.map((d) => d.name).join(', ')}.
        </p>
      )}
    </>
  )
}

export function DebtsSection() {
  const [extra, setExtra] = useState('')
  const extraCents = useDebounced(Math.max(0, parseMoney(extra) ?? 0), 400)
  const accounts = useAction('list_accounts')
  if (!accounts.data) return accounts.error ? <ErrorNote error={accounts.error} /> : <Loading />
  const debts = accounts.data.filter((a) => isOwed(a) && !a.hidden && (a.balanceCents ?? 0) > 0)
  if (debts.length === 0) {
    return (
      <Card label="Debts">
        <p className="empty">No credit cards or loans with a balance. Nothing to pay off.</p>
      </Card>
    )
  }
  return (
    <>
      <Card label="Your debts" className="stack-sm">
        <h2>Your debts</h2>
        <p className="small muted">
          Banks rarely send interest rates. Find them on each statement and add them here.
        </p>
        {debts.map((account) => (
          <DebtTerms key={account.id} account={account} />
        ))}
      </Card>
      <Card label="Payoff plan" className="stack">
        <div className="row-between wrap">
          <h2>Payoff plan</h2>
          <Setting label="Extra each month">
            <input
              className="input num"
              style={{ width: 110 }}
              inputMode="decimal"
              aria-label="Extra each month"
              placeholder="0"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </Setting>
        </div>
        <PayoffPlan extraCents={extraCents} />
      </Card>
    </>
  )
}
