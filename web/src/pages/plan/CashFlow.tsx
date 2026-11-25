// Cash until payday, on the Payday tab after this paycheck: checking as a
// line, from what it holds today down through each bill to payday
// (lib/cashPath.ts), with the day it would go below $0 if it would. That dip
// is a status, said in words with what would cover it (BelowZeroWarning), on
// Payday and the Home widget alike; without one the card stays calm and
// names the lowest point. Savings is left out, as money set aside rather
// than what the bills come out of. The card opens the math behind safe to
// spend (lib/drills/plan.ts, server/src/domain/cashFlow.ts).
// With no checking balance known yet, there is no cash to judge: the card
// says so, with no figure, line or warning that would read as $0.
// Home's cash widget leads instead with what is safe to spend (CashFacts).

import type { ReactNode } from 'react'
import { Card } from '../../components/design/Card'
import type { CashFlow } from '../../api/client'
import { useAction } from '../../api/hooks'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { dayLabel, shortDate } from '../../lib/format'
import { Money } from '../../components/design/Money'
import { CashLine } from '../../components/charts/CashLine'
import { cashPath, lowestPoint, shortTone } from '../../lib/cashPath'
import { cashFlowDrill } from '../../lib/drills/plan'
import { BelowZeroWarning } from './BelowZeroWarning'

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
 * Where the line starts and how low it gets. A dip below $0 is left to the
 * warning under it; otherwise the lowest point is named calmly, or that no
 * bill comes out before payday.
 */
function LineHeadline({ flow }: { flow: CashFlow }) {
  const { settings } = useApp()
  const low = lowestPoint(cashPath(flow))
  let rest: ReactNode = ', with no bills before payday.'
  if (flow.belowZero) rest = '.'
  else if (flow.billsDue.length > 0) {
    rest = (
      <>
        , at its lowest <Money cents={low.cents} /> on {shortDate(low.date, settings.locale)}.
      </>
    )
  }
  return (
    <p style={{ fontSize: 17 }}>
      From <Money cents={flow.cashCents} className="mid-number" /> in checking today{rest}
    </p>
  )
}

/**
 * The headline: what is safe to spend until payday, or how far short the
 * bills leave you. Against a payday that is only a guess the shortfall may
 * be less, so it is said plainly, not in red.
 */
function SafeHeadline({ flow }: { flow: CashFlow }) {
  if (flow.shortfallCents > 0) {
    const owed = flow.overdraftCents > 0 ? 'the bills and overdraft' : 'the bills'
    return (
      <p style={{ fontSize: 17 }}>
        {flow.paydayEstimate && 'Maybe '}
        <Money cents={flow.shortfallCents} tone={shortTone(flow)} className="mid-number" /> short of{' '}
        {owed} due before payday.
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

/** Checking after each bill, day by day, to payday. */
function CashPathChart({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  const points = cashPath(flow)
  // With no bill before payday the line is flat, so the sentence above says it all.
  if (points.every((point) => point.bills.length === 0)) return null
  const low = lowestPoint(points)
  const dip = flow.belowZero
    ? ` It goes below ${money(0)} on ${shortDate(flow.belowZero.date, settings.locale)}.`
    : ''
  return (
    <CashLine
      points={points}
      label="Checking until payday"
      description={`Checking from ${money(points[0]!.cents)} today to ${money(points.at(-1)!.cents)} on payday, ${dayLabel(flow.nextPayday, settings.locale)}, at its lowest ${money(low.cents)} on ${shortDate(low.date, settings.locale)}.${dip}`}
    />
  )
}

/** What can be said with no checking balance: the bills due, and when payday is. */
function UnknownCash({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  return (
    <>
      <p style={{ fontSize: 17 }}>Checking&apos;s balance isn&apos;t known yet.</p>
      <span className="small muted">
        {flow.billsDueCents > 0 && (
          <>
            <Money cents={flow.billsDueCents} /> in bills due before payday.{' '}
          </>
        )}
        {paydayText(flow, money, settings.locale)}
      </span>
    </>
  )
}

/**
 * Home's widget: what is safe to spend until payday and the sum behind it,
 * what checking holds less the bills, and when payday is.
 */
export function CashFacts({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  if (!flow.cashKnown) return <UnknownCash flow={flow} />
  return (
    <>
      <SafeHeadline flow={flow} />
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
      <BelowZeroWarning flow={flow} />
    </>
  )
}

/** Payday's card: where checking starts and how low it goes, any dip in words, and when payday is. */
function LineFacts({ flow }: { flow: CashFlow }) {
  const { money, settings } = useApp()
  if (!flow.cashKnown) return <UnknownCash flow={flow} />
  return (
    <>
      <LineHeadline flow={flow} />
      <BelowZeroWarning flow={flow} />
      <span className="small muted">{paydayText(flow, money, settings.locale)}</span>
    </>
  )
}

/** The line to payday and each bill due before it, under the card's button. */
function CashDetails({ flow }: { flow: CashFlow }) {
  const { settings } = useApp()
  return (
    <>
      {flow.cashKnown && <CashPathChart flow={flow} />}
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

const TITLE = 'Cash until payday'

/** The Until payday card on the Payday tab: the words open the math, the line reads under a finger. */
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
      <LineFacts flow={flow} />
    </Card>
  )
}
