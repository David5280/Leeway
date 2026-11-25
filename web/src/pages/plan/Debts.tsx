// Debt payoff: what the cards cost in interest a month, the terms of each
// card and loan, and how fast each strategy clears them.

import { Card } from '../../components/design/Card'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Account, DebtPlans } from '../../api/client'
import { useAction } from '../../api/hooks'
import { LoadingOrError, Segmented, Setting } from '../../components/ui'
import { AmountNote, useAmountField } from '../../components/AmountNote'
import { cardInterestTotal, isCounted, isOwed } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { monthYear, parseMoney } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { DebtTerms } from './DebtTerms'
import { durationText } from './text'
import { Money } from '../../components/design/Money'
import { CardsCostSentence } from '../accounts/CardInterest'
import { settingsPath } from '../settings/paths'

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
  const { settings } = useApp()
  const plan = plans[strategy]
  const { label } = STRATEGIES.find((s) => s.value === strategy)!
  return (
    <div className="span-4 stack-sm" role="group" aria-label={`${label} plan`}>
      <span className="eyebrow">{label}</span>
      <span className="num mid-number">
        {plan.debtFreeDate ? monthYear(plan.debtFreeDate, settings.locale) : 'Never'}
      </span>
      <span className="small muted">
        {durationText(plan.months)}, <Money cents={plan.totalInterestCents} /> interest
      </span>
    </div>
  )
}

function PayoffPlan({ extraCents }: { extraCents: number }) {
  const [strategy, setStrategy] = useState<Strategy>('avalanche')
  const plans = useAction('plan_debt_payoff', { extraCents }, { placeholderData: keepPreviousData })
  if (!plans.data) return <LoadingOrError error={plans.error} />
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
        Paying <Money cents={plan.monthlyPaymentCents} /> a month in all.
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

/** What carrying the cards' balances costs a month, once at least one has its APR. */
function CardsCost({ accounts }: { accounts: Account[] }) {
  const total = cardInterestTotal(accounts)
  if (total.cards.length === total.missingApr) return null
  return (
    <p style={{ fontSize: 17 }}>
      <CardsCostSentence total={total} figureClassName="mid-number" />
    </p>
  )
}

export function DebtsSection() {
  const [extra, setExtra] = useState('')
  const extraField = useAmountField(extra, { min: 0 })
  // One that can't be read, or a negative one, counts as no extra, and its note says so.
  const extraCents = useDebounced(extraField.note !== null ? 0 : (parseMoney(extra) ?? 0), 400)
  const accounts = useAction('list_accounts')
  if (!accounts.data) return <LoadingOrError error={accounts.error} />
  // The ones the payoff plan counts: shown, still shared by the bank, and owing.
  const debts = accounts.data.filter((a) => isOwed(a) && isCounted(a) && (a.balanceCents ?? 0) > 0)
  if (debts.length === 0) return <NoDebts hasAccounts={accounts.data.length > 0} />
  return (
    <>
      <Card static="list" label="Your debts" className="stack-sm">
        <h2>Your debts</h2>
        <CardsCost accounts={debts} />
        <p className="small muted">
          Banks rarely send interest rates. Find them on each statement and add them here.
        </p>
        {debts.map((account) => (
          <DebtTerms key={account.id} account={account} />
        ))}
      </Card>
      <Card static="pending" label="Payoff plan" className="stack">
        <div className="row-between wrap">
          <h2>Payoff plan</h2>
          <Setting label="Extra each month">
            <input
              className="input num"
              style={{ width: 110 }}
              inputMode="decimal"
              aria-label="Extra each month"
              placeholder="0"
              {...extraField.inputProps}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </Setting>
        </div>
        {/* The plan then counts no extra, so say why rather than show it quietly. */}
        <AmountNote id={extraField.id} text={extraField.shown} />
        <PayoffPlan extraCents={extraCents} />
      </Card>
    </>
  )
}

/** Nothing owed: said plainly, or, with no accounts yet, the way to bring them in. */
function NoDebts({ hasAccounts }: { hasAccounts: boolean }) {
  return (
    <Card static="empty" label="Debts">
      {hasAccounts ? (
        <p className="empty">No credit cards or loans with a balance, so nothing to pay off.</p>
      ) : (
        <p className="empty">
          No accounts yet. <Link to={settingsPath('banks')}>Connect a bank</Link> to see what your
          cards and loans cost.
        </p>
      )}
    </Card>
  )
}
