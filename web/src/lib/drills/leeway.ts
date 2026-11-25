// What Leeway's tap-through shows: the math of whichever figure sets what
// you can spend. The server's spendable is the lesser of the budget's room
// and what is safe to spend from checking, so the drill-down is that one's
// math: the budgets less what is spent in them and set aside, or checking
// less the bills before payday. The figure itself is always the budget's, so
// only the sheet waits while the cash flow is read.

import type { Budget, CashFlow } from '../../api/client'
import type { CardDrill } from '../drill'
import { paths } from '../../routes'
import type { SetBy } from '../leewayLead'
import { leewayDrill } from './budget'
import { cashFlowDrill } from './plan'

/** Amounts as the app writes them. */
type Money = (cents: number) => string

/** The cash flow read for the sheet: its data once in, or why it could not be read. */
interface FlowRead {
  data?: CashFlow
  error?: unknown
}

/**
 * The drill-down behind Leeway, titled as Leeway so the sheet answers "what
 * sets it": the cash flow's math when the cash sets it, otherwise the
 * budget's. Until the cash flow is in, or when it fails, the sheet says so.
 */
export function leewayDrillFor(
  setBy: SetBy,
  budget: Budget,
  flow: FlowRead,
  money: Money,
  date: (iso: string) => string,
): CardDrill {
  if (setBy === 'cash') {
    if (!flow.data) {
      return {
        title: 'Your leeway',
        subtitle: 'Set by your cash.',
        loading: 'Loading your cash flow',
        error: flow.error ?? undefined,
      }
    }
    const cash = cashFlowDrill(flow.data, date)
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
