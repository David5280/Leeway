// The rows under the new paycheck's figure. With pay known they read as a
// sum that ends on its own total: pay, minus this pay period's bills (paid
// or not), minus what is set aside, is what is left for everyday spending.
// Safe to spend now, the figure Home leads with (spendable),
// sits apart under the sum with its own label, so it never reads as the
// total. Totals only; the card's drill-down lists every line, and the Goals
// tab explains what is set aside.

import type { PaycheckPlan } from '../../../api/client'
import { SumRow } from '../../../components/design/SumRow'
import { billNames, setAsideWords } from './playbookText'

/** Safe to spend now, labelled as its own figure rather than a line of the sum. */
function SafeToSpend({ cents }: { cents: number }) {
  return (
    <SumRow
      name="Safe to spend now"
      detail="What you can spend today, as Home shows it"
      cents={cents}
      className="playbook-apart"
    />
  )
}

/** The sum with pay known; each part only when there is something in it. */
function Sum({ plan, estimate }: { plan: PaycheckPlan; estimate: boolean }) {
  const held = plan.lines.filter((line) => line.kind !== 'bill')
  return (
    <span className="playbook-sum" role="group" aria-label="How this paycheck adds up">
      <SumRow
        name="Pay"
        detail={estimate ? 'An estimate until more paychecks show' : undefined}
        cents={plan.paycheckCents!}
        sum="plus"
        tone="in"
      />
      {plan.billsCents > 0 && (
        <SumRow
          name="Bills this pay period"
          detail={billNames(plan.lines)}
          cents={plan.billsCents}
          sum="minus"
        />
      )}
      {plan.setAsideCents > 0 && (
        <SumRow
          name="Set aside"
          detail={setAsideWords(held)}
          cents={plan.setAsideCents}
          sum="minus"
        />
      )}
      <SumRow
        name="Left for everyday spending"
        cents={plan.everydayCents!}
        tone={plan.everydayCents! < 0 ? 'warn' : undefined}
        className="playbook-total"
      />
    </span>
  )
}

/**
 * The sum, then safe to spend apart from it. Without pay there is no sum:
 * the totals stand plain, and safe to spend is the card's figure itself.
 */
export function PlanRows({ plan, estimate }: { plan: PaycheckPlan; estimate: boolean }) {
  if (plan.paycheckCents === null || plan.everydayCents === null) {
    const held = plan.lines.filter((line) => line.kind !== 'bill')
    return (
      <span className="playbook-rows">
        {plan.billsCents > 0 && (
          <SumRow
            name="Bills this pay period"
            detail={billNames(plan.lines)}
            cents={plan.billsCents}
          />
        )}
        {plan.setAsideCents > 0 && (
          <SumRow name="Set aside" detail={setAsideWords(held)} cents={plan.setAsideCents} />
        )}
      </span>
    )
  }
  return (
    <span className="playbook-rows">
      <Sum plan={plan} estimate={estimate} />
      <SafeToSpend cents={plan.safeToSpendCents} />
    </span>
  )
}
