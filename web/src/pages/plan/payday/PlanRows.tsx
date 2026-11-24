// The rows under the new paycheck's figure, read as a sum: pay, minus the
// bills before payday, minus what is set aside, makes the everyday budget
// above them. Then what is safe to spend now, the figure Home and Spending
// lead with (spendable). Totals only; the card's drill-down lists every
// line, and the Goals tab explains what is set aside.

import type { ReactNode } from 'react'
import type { PaycheckPlan } from '../../../api/client'
import { Money } from '../../../components/design/Money'
import type { MoneyTone } from '../../../lib/money'
import { billNames, setAsideWords } from './playbookText'

interface RowProps {
  name: string
  detail?: ReactNode
  cents: number
  /** In the sum, pay reads "+" and what comes out of it "−"; otherwise a plain figure. */
  sum?: 'plus' | 'minus'
  tone?: MoneyTone
}

function Row({ name, detail, cents, sum, tone }: RowProps) {
  return (
    <span className="list-row">
      <span className="grow playbook-row-words">
        <span className="playbook-row-name">{name}</span>
        {detail && <span className="small muted">{detail}</span>}
      </span>
      <b className="num">
        <Money
          cents={sum === 'minus' ? -cents : cents}
          sign={sum ? 'change' : 'plain'}
          tone={tone}
        />
      </b>
    </span>
  )
}

/** Each total only when there is something in it; safe to spend is the figure itself without pay. */
export function PlanRows({ plan }: { plan: PaycheckPlan }) {
  const held = plan.lines.filter((line) => line.kind !== 'bill')
  const paid = plan.paycheckCents !== null
  // Without pay there is no sum to read, so the totals stand plain.
  const out = paid ? 'minus' : undefined
  return (
    <span className="playbook-rows">
      {paid && <Row name="Pay" cents={plan.paycheckCents!} sum="plus" tone="in" />}
      {plan.billsCents > 0 && (
        <Row
          name="Bills before payday"
          detail={billNames(plan.lines)}
          cents={plan.billsCents}
          sum={out}
        />
      )}
      {plan.setAsideCents > 0 && (
        <Row name="Set aside" detail={setAsideWords(held)} cents={plan.setAsideCents} sum={out} />
      )}
      {paid && <Row name="Safe to spend now" cents={plan.safeToSpendCents} />}
    </span>
  )
}
