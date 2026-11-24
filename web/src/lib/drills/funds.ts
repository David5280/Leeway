// The drill-down for sinking funds: what the yearly costs hold back each
// budget period, cost by cost. Pure, like every drill in lib/drills.

import type { SinkingFundsView } from '../../api/client'
import { FUND_CADENCE_WORDS } from '../../pages/plan/goals/yearly/fundText'
import type { DrillDown } from '../drill'

/** The drill for these funds; `word` names a budget period, like "month". */
export function fundsDrill(
  view: SinkingFundsView,
  date: (iso: string) => string,
  word: string,
): DrillDown {
  const each = `Set aside each ${word}`
  return {
    title: 'Yearly costs',
    subtitle: each,
    figure: { cents: view.totalPerPeriodCents },
    math: {
      terms: view.funds.map((fund, index) => ({
        label: fund.name,
        value: { cents: fund.perPeriodCents },
        ...(index > 0 && { op: 'plus' as const }),
      })),
      result: { label: each, value: { cents: view.totalPerPeriodCents } },
      note: `Each cost is spread evenly over the time until it comes round again, so it is there when it lands. Leeway holds this much back from what is safe to spend each ${word}, the way it does a goal. It never moves money.`,
    },
    items: {
      title: 'Coming due',
      rows: view.funds.map((fund) => ({
        key: fund.id,
        label: fund.name,
        detail: `${FUND_CADENCE_WORDS[fund.cadence]}, next ${date(fund.nextDueDate)}`,
        value: { cents: fund.amountCents },
      })),
    },
  }
}
