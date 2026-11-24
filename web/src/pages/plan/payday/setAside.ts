// What is set aside from each paycheck, as Payday and Goals both say it. The
// playbook's plan shares every goal, trip and yearly cost out per paycheck
// once pay is known; until then the shares stay per budget period, so the
// unit is named from the plan rather than assumed. Payday shows the total as
// one line linking to Goals, where the parts behind it live.

import type { PaycheckPlan, PlanLine } from '../../../api/client'
import type { LinkRow } from '../../../components/LinkRows'
import { paths } from '../../../routes'
import { setAsideWords } from './playbookText'

/** The plan's lines that are set aside (goals, trips, yearly costs), leaving the bills out. */
export const setAsideLines = (plan: PaycheckPlan): PlanLine[] =>
  plan.lines.filter((line) => line.kind !== 'bill')

/**
 * What one share is "each" of: a paycheck once pay is known, otherwise the
 * budget period (`periodWord`, like "month"), since shares are not spread to pay yet.
 */
export function setAsideUnit(plan: PaycheckPlan, periodWord: string): string {
  return plan.paycheckCents === null ? periodWord : 'paycheck'
}

/**
 * Payday's one line for what is set aside, linking to Goals: the total and
 * what it is for once the plan has loaded, a plain pointer before then or
 * when nothing is set aside.
 */
export function setAsideRow(
  plan: PaycheckPlan | undefined,
  money: (cents: number) => string,
  periodWord: string,
): LinkRow {
  const row = { to: paths.goals(), icon: 'piggy' as const }
  if (!plan || plan.setAsideCents === 0) {
    return { ...row, label: 'Goals and yearly costs', detail: 'What you are saving for' }
  }
  return {
    ...row,
    label: `Set aside: ${money(plan.setAsideCents)} each ${setAsideUnit(plan, periodWord)}`,
    detail: `${setAsideWords(setAsideLines(plan))}, on Goals`,
  }
}
