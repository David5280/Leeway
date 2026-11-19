// Cash until payday: what is on hand, the bills due first, and what that leaves per day.

import type { CashFlow } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card, LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { dayLabel, shortDate } from '../../lib/format'
import { Money } from '../../components/design/Money'

/** One line on where the payday came from, so the number can be trusted the right amount. */
function paydayText(flow: CashFlow, money: (cents: number) => string, locale: string): string {
  const day = dayLabel(flow.nextPayday, locale)
  switch (flow.paydaySource) {
    case 'pay_period':
      return `Next payday ${day}.`
    case 'detected_income':
      return `Next payday looks like ${day}, about ${money(flow.expectedPayCents!)}, going by your past deposits.`
    default:
      return `No paycheck found yet, so this runs to the end of your budget period, ${day}.`
  }
}

/** The headline: per-day room, or how far short the bills leave you. */
function Headline({ flow }: { flow: CashFlow }) {
  const days = Math.max(1, flow.daysUntilPayday)
  if (flow.leftAfterBillsCents < 0) {
    return (
      <p style={{ fontSize: 17 }}>
        <Money cents={-flow.leftAfterBillsCents} tone="problem" className="mid-number" /> short of
        the bills due before payday.
      </p>
    )
  }
  return (
    <p style={{ fontSize: 17 }}>
      <Money cents={flow.perDayCents} className="mid-number" /> a day for the next {days}{' '}
      {days === 1 ? 'day' : 'days'}.
    </p>
  )
}

/** Cash until payday. Compact leaves out the list of bills, for the dashboard. */
export function CashFlowSummary({ compact = false }: { compact?: boolean }) {
  const { money, settings } = useApp()
  const cash = useAction('get_cash_flow')
  if (!cash.data) {
    return <LoadingOrError error={cash.error} />
  }
  const flow = cash.data
  return (
    <div className="stack-sm">
      <Headline flow={flow} />
      <span className="small muted">
        <Money cents={flow.cashCents} /> in checking and savings, minus{' '}
        <Money cents={flow.billsDueCents} /> in bills. {paydayText(flow, money, settings.locale)}
      </span>
      {!compact &&
        flow.billsDue.map((bill) => (
          <div key={`${bill.billId}-${bill.dueDate}`} className="list-row">
            <span className="num small muted" style={{ width: 56, flex: 'none' }}>
              {shortDate(bill.dueDate, settings.locale)}
            </span>
            <span className="grow">
              {bill.name}
              {bill.overdue && <span className="small over"> No payment found</span>}
            </span>
            <Money cents={bill.amountCents} precision="cents" />
          </div>
        ))}
    </div>
  )
}

/** The card at the top of the Plan screen. */
export function CashFlowCard() {
  return (
    <Card label="Until payday" className="stack-sm">
      <p className="eyebrow">Until payday</p>
      <CashFlowSummary />
    </Card>
  )
}
