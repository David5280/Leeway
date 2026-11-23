// Cash until payday: what checking holds, less the bills due first and any
// overdraft, is what is safe to spend (server/src/domain/cashFlow.ts).
// Savings is left out, as money set aside rather than what the bills come
// out of. On the Plan's bills, the question and answer open
// the math (lib/drills/plan.ts), and under them a line shows checking
// stepping down with each bill to payday; if it would go below $0, that part
// is red and the card says when. The Overview's widget shows the answer alone.

import { Card } from '../../components/design/Card'
import type { CashFlow } from '../../api/client'
import { useAction } from '../../api/hooks'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { dayLabel, shortDate } from '../../lib/format'
import { Money } from '../../components/design/Money'
import { CashLine } from '../../components/charts/CashLine'
import { cashPath, firstBelowZero, lowestPoint, type CashPoint } from '../../lib/cashPath'
import { cashFlowDrill } from '../../lib/drills/plan'

/** One line on where the payday came from, so the number can be trusted the right amount. */
function paydayText(flow: CashFlow, money: (cents: number) => string, locale: string): string {
  const day = dayLabel(flow.nextPayday, locale)
  switch (flow.paydaySource) {
    case 'pay_period':
      return `Next payday ${day}.`
    case 'detected_income':
      return flow.paydayEstimate
        ? `Next payday looks like ${day}, about ${money(flow.expectedPayCents!)}. A best guess until more paychecks show how often pay comes.`
        : `Next payday looks like ${day}, about ${money(flow.expectedPayCents!)}, going by your paychecks.`
    default:
      return `No paycheck found yet, so this runs to the end of your budget period, ${day}.`
  }
}

/**
 * The headline: what is safe to spend until payday, or how far short the
 * bills leave you. Against a payday that is only a guess the shortfall may
 * be less, so it is said plainly, not in red.
 */
function Headline({ flow }: { flow: CashFlow }) {
  if (flow.shortfallCents > 0) {
    const owed = flow.overdraftCents > 0 ? 'the bills and overdraft' : 'the bills'
    const guess = flow.paydayEstimate
    return (
      <p style={{ fontSize: 17 }}>
        {guess && 'Maybe '}
        <Money
          cents={flow.shortfallCents}
          tone={guess ? 'warn' : 'problem'}
          className="mid-number"
        />{' '}
        short of {owed} due before payday.
      </p>
    )
  }
  return (
    <p style={{ fontSize: 17 }}>
      <Money cents={flow.safeCents} className="mid-number" /> safe to spend until payday, after
      bills.
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
      {below && <BelowZero point={below} today={flow.today} locale={settings.locale} />}
    </>
  )
}

/** The day checking first goes below $0, in plain words: when, and which bills take it there. */
function BelowZero({ point, today, locale }: { point: CashPoint; today: string; locale: string }) {
  const zero = <Money cents={0} />
  // The line starts at the balance now, so a first point below $0 with no bill is today's balance.
  if (point.bills.length === 0) {
    return <p className="small over">Checking is already below {zero}.</p>
  }
  const verb = point.bills.length === 1 ? 'comes' : 'come'
  const when = point.date === today ? 'today' : `on ${shortDate(point.date, locale)}`
  return (
    <p className="small over">
      Checking goes below {zero} {when}, when {point.bills.join(' and ')} {verb} out.
    </p>
  )
}

/** The answer and the sum behind it: what checking holds, less the bills, and when payday is. */
export function CashFacts({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  return (
    <>
      <Headline flow={flow} />
      <span className="small muted">
        <Money cents={flow.cashCents} /> in checking, minus <Money cents={flow.billsDueCents} /> in
        bills
        {flow.overdraftCents > 0 && (
          <>
            {' '}
            and <Money cents={flow.overdraftCents} /> to bring an overdraft back to zero
          </>
        )}
        . {paydayText(flow, money, settings.locale)}
      </span>
    </>
  )
}

/** The line to payday and each bill due before it, under the card's button. */
function CashDetails({ flow }: { flow: CashFlow }) {
  const { settings } = useApp()
  return (
    <>
      <CashPathChart flow={flow} />
      {flow.billsDue.map((bill) => (
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
    </>
  )
}

const TITLE = 'Will the cash last until payday?'

/** The card at the top of the Plan's bills: the answer opens the math, the line reads under a finger. */
export function CashFlowCard() {
  const { settings } = useApp()
  const cash = useAction('get_cash_flow')
  if (!cash.data) {
    return (
      <Card static="empty" label="Until payday" className="stack-sm">
        <h2>{TITLE}</h2>
        <LoadingOrError error={cash.error} />
      </Card>
    )
  }
  const flow = cash.data
  return (
    <Card
      drill={cashFlowDrill(flow, (iso) => dayLabel(iso, settings.locale))}
      below={<CashDetails flow={flow} />}
      label="Until payday"
      className="stack-sm"
    >
      <h2>{TITLE}</h2>
      <CashFacts flow={flow} />
    </Card>
  )
}
