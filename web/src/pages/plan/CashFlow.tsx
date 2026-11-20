// Cash until payday: what checking holds, the bills due first, and what that
// leaves at payday. Savings is left out, as money set aside rather than what
// the bills come out of. On Plan, a line shows checking stepping down with
// each bill to payday; if it would go below $0, that part is red and the card
// says when.

import { Card } from '../../components/design/Card'
import type { CashFlow } from '../../api/client'
import { useAction } from '../../api/hooks'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { dayLabel, shortDate } from '../../lib/format'
import { Money } from '../../components/design/Money'
import { CashLine } from '../../components/charts/CashLine'
import { cashPath, firstBelowZero, lowestPoint, type CashPoint } from '../../lib/cashPath'

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

/** The headline: what is left at payday once the bills are paid, or how far short they leave you. */
function Headline({ flow }: { flow: CashFlow }) {
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
      <Money cents={flow.leftAfterBillsCents} className="mid-number" /> left at payday, after bills.
    </p>
  )
}

/** "Will the cash last until payday?": checking after each bill, day by day. */
function CashPathChart({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  const points = cashPath(flow)
  // With no bill before payday the line is flat, so the sentence above says it all.
  if (points.every((point) => point.bills.length === 0)) return null
  const low = lowestPoint(points)
  const below = firstBelowZero(points)
  return (
    <>
      <CashLine
        points={points}
        label="Checking until payday"
        description={`Checking from ${money(points[0]!.cents)} today to ${money(points.at(-1)!.cents)} on payday, ${dayLabel(flow.nextPayday, settings.locale)}, at its lowest ${money(low.cents)} on ${shortDate(low.date, settings.locale)}.`}
      />
      {below && <BelowZero point={below} locale={settings.locale} />}
    </>
  )
}

/** The day checking first goes below $0, in plain words: when, and which bills take it there. */
function BelowZero({ point, locale }: { point: CashPoint; locale: string }) {
  const zero = <Money cents={0} />
  if (point.bills.length === 0) {
    return <p className="small over">Checking is already below {zero}.</p>
  }
  const verb = point.bills.length === 1 ? 'comes' : 'come'
  return (
    <p className="small over">
      Checking goes below {zero} on {shortDate(point.date, locale)}, when{' '}
      {point.bills.join(' and ')} {verb} out.
    </p>
  )
}

/** Cash until payday. Compact leaves out the chart and the list of bills, for the dashboard. */
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
        <Money cents={flow.cashCents} /> in checking, minus <Money cents={flow.billsDueCents} /> in
        bills. {paydayText(flow, money, settings.locale)}
      </span>
      {!compact && <CashPathChart flow={flow} />}
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
    <Card static="pending" label="Until payday" className="stack-sm">
      <h2>Will the cash last until payday?</h2>
      <CashFlowSummary />
    </Card>
  )
}
