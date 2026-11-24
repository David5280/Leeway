// The drill-down for what is set aside each paycheck, the figure Goals leads
// with: each goal, trip and yearly cost's share, added up. The shares are the
// payday playbook's own, so Goals and Payday never disagree. Pure, like every
// drill in lib/drills.

import type { PaycheckPlan } from '../../api/client'
import { LINE_WORDS } from '../../pages/plan/payday/playbookText'
import { setAsideLines, setAsideUnit } from '../../pages/plan/payday/setAside'
import type { DrillDown } from '../drill'

/** The drill for this plan's set-asides; `periodWord` names a budget period, like "month". */
export function setAsideDrill(plan: PaycheckPlan, periodWord: string): DrillDown {
  const unit = setAsideUnit(plan, periodWord)
  const lines = setAsideLines(plan)
  const each = `Set aside each ${unit}`
  return {
    title: 'Set aside',
    subtitle: each,
    figure: { cents: plan.setAsideCents },
    math: {
      terms: lines.map((line, index) => ({
        label: line.name,
        value: { cents: line.amountCents },
        ...(index > 0 && { op: 'plus' as const }),
      })),
      result: { label: each, value: { cents: plan.setAsideCents } },
      note: `Each goal set aside from your budget, trip budget and yearly cost holds back its share of every ${unit}, so the money is there when it is needed. Leeway never moves money.`,
    },
    items: {
      title: 'What it is for',
      rows: lines.map((line, index) => ({
        key: `${line.kind}-${index}`,
        label: line.name,
        detail: LINE_WORDS[line.kind],
        value: { cents: line.amountCents },
      })),
    },
  }
}
