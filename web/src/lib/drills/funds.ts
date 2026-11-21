// The drill-down for sinking funds: what the yearly costs come to each
// paycheck, cost by cost. Pure, like every drill in lib/drills.

import type { SinkingFundsView } from '../../api/client'
import { FUND_CADENCE_WORDS, shareWords } from '../../pages/plan/payday/fundText'
import type { DrillDown } from '../drill'

export function fundsDrill(view: SinkingFundsView, date: (iso: string) => string): DrillDown {
  const each = shareWords(view)
  return {
    title: 'Yearly costs',
    subtitle: `Set aside ${each}`,
    figure: { cents: view.totalShareCents },
    math: {
      terms: view.funds.map((fund, index) => ({
        label: fund.name,
        value: { cents: fund.shareCents },
        ...(index > 0 && { op: 'plus' as const }),
      })),
      result: { label: `Set aside ${each}`, value: { cents: view.totalShareCents } },
      note: 'Each cost spread evenly over the time until it comes round again, so it is there when it lands. Leeway holds it back from your budget, the way it does a goal. It never moves money.',
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
