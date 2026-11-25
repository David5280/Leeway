// What Leeway's tap-through shows: the math of whichever figure sets what
// you can spend. The server's spendable is the lesser of the budget's room
// and what is safe to spend from checking, so the drill-down is that one's
// math: the budgets less what is spent in them and set aside, or checking
// less the bills before payday.

import type { Budget, CashFlow } from '../../api/client'
import type { DrillDown } from '../drill'
import { paths } from '../../routes'
import type { SetBy } from '../leewayLead'
import { leewayDrill } from './budget'
import { cashFlowDrill } from './plan'

/** Amounts as the app writes them. */
type Money = (cents: number) => string

/**
 * The drill-down behind Leeway, titled as Leeway so the sheet answers "what
 * sets it": the cash flow's math when the cash sets it (null until the cash
 * flow is read), otherwise the budget's.
 */
export function leewayDrillFor(
  setBy: SetBy,
  budget: Budget,
  flow: CashFlow | undefined,
  money: Money,
  date: (iso: string) => string,
): DrillDown | null {
  if (setBy === 'cash') {
    if (!flow) return null
    const cash = cashFlowDrill(flow, date)
    return {
      ...cash,
      title: 'Your leeway',
      subtitle: `Set by your cash. ${cash.subtitle ?? ''}`.trim(),
      more: { to: paths.payday(), label: 'Open Payday' },
    }
  }
  const { daysElapsed, days } = budget.period
  return {
    ...leewayDrill(budget, money),
    title: 'Your leeway',
    subtitle: `Set by your budget. Day ${daysElapsed} of ${days}.`,
  }
}
