// The quiet rows under the new paycheck's figure: bills due before payday,
// what is set aside, and what is safe to spend now. Totals only; the card's
// drill-down lists every line, and the Yearly costs card explains its own.

import type { ReactNode } from 'react'
import type { PaycheckPlan } from '../../../api/client'
import { Money } from '../../../components/design/Money'
import { billNames, holdsYearlyCosts, setAsideWords } from './playbookText'

function Row({ name, detail, cents }: { name: string; detail?: ReactNode; cents: number }) {
  return (
    <span className="list-row">
      <span className="grow playbook-row-words">
        <span className="playbook-row-name">{name}</span>
        {detail && <span className="small muted">{detail}</span>}
      </span>
      <b className="num">
        <Money cents={cents} />
      </b>
    </span>
  )
}

/** Each total only when there is something in it; safe to spend is the figure itself without pay. */
export function PlanRows({ plan }: { plan: PaycheckPlan }) {
  const held = plan.lines.filter((line) => line.kind !== 'bill')
  const yearly = holdsYearlyCosts(held) ? ' (see Yearly costs below)' : ''
  return (
    <span className="playbook-rows">
      {plan.billsCents > 0 && (
        <Row name="Bills before payday" detail={billNames(plan.lines)} cents={plan.billsCents} />
      )}
      {plan.setAsideCents > 0 && (
        <Row
          name="Set aside"
          detail={`${setAsideWords(held)}${yearly}`}
          cents={plan.setAsideCents}
        />
      )}
      {plan.paycheckCents !== null && (
        <Row name="Safe to spend now" cents={plan.safeToSpendCents} />
      )}
    </span>
  )
}
