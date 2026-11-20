// The lists on one account's page: bills paid from it, repeating charges and
// subscriptions not yet tracked, fees it was charged, and the goals that
// track it. Each list shows only when it has something in it, and each row
// opens where that thing is managed.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Bill, Goal, RecurringSeries, Transaction } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { ProgressRing } from '../../components/design/ProgressRing'
import { SectionHead } from '../../components/design/SectionHead'
import type { IconName } from '../../components/ui'
import { useApp } from '../../lib/app'
import { shortDate } from '../../lib/format'

/** One row: what it is, a line about it, and its amount or progress, opening `to`. */
function Row({
  to,
  name,
  detail,
  end,
}: {
  to: string
  name: string
  detail: ReactNode
  end: ReactNode
}) {
  return (
    <Link to={to} className="list-row clickrow detail-row">
      <span className="grow stack-sm" style={{ gap: 0 }}>
        <span className="detail-row-name">{name}</span>
        <span className="small muted">{detail}</span>
      </span>
      {end}
    </Link>
  )
}

/** A titled list card, left out entirely when it has no rows. */
function ListCard({ icon, title, rows }: { icon: IconName; title: string; rows: ReactNode[] }) {
  if (rows.length === 0) return null
  return (
    <Card static="list" label={title} className="stack-sm">
      <SectionHead icon={icon} title={title} />
      {rows}
    </Card>
  )
}

const BILL_STATUS: Record<Bill['status'], string> = {
  paid: 'Paid',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
}

export function BillsCard({ bills }: { bills: readonly Bill[] }) {
  const { settings } = useApp()
  return (
    <ListCard
      icon="receipt"
      title="Bills paid from here"
      rows={bills.map((bill) => (
        <Row
          key={bill.id}
          to="/plan/bills"
          name={bill.name}
          detail={`${BILL_STATUS[bill.status]}, next due ${shortDate(bill.nextDueDate, settings.locale)}`}
          end={<Money cents={bill.amountCents} />}
        />
      ))}
    />
  )
}

export function RecurringCard({ series }: { series: readonly RecurringSeries[] }) {
  const { settings } = useApp()
  return (
    <ListCard
      icon="repeat"
      title="Repeating charges"
      rows={series.map((one) => (
        <Row
          key={one.key}
          to="/plan/bills"
          name={one.name}
          detail={`${one.suggestedKind === 'subscription' ? 'Subscription' : 'Repeats'}, next about ${shortDate(one.nextDate, settings.locale)}`}
          end={<Money cents={one.typicalAmountCents} />}
        />
      ))}
    />
  )
}

export function FeesCard({ fees, accountId }: { fees: readonly Transaction[]; accountId: string }) {
  const { settings } = useApp()
  return (
    <ListCard
      icon="warn"
      title="Fees charged"
      rows={fees.map((fee) => (
        <Row
          key={fee.id}
          to={`/transactions?account=${encodeURIComponent(accountId)}`}
          name={fee.displayName}
          detail={shortDate(fee.date, settings.locale)}
          end={<Money cents={fee.amountCents} tone="problem" />}
        />
      ))}
    />
  )
}

export function GoalsCard({ goals }: { goals: readonly Goal[] }) {
  return (
    <ListCard
      icon="target"
      title="Goals on this account"
      rows={goals.map((goal) => (
        <Row
          key={goal.id}
          to="/plan/goals"
          name={goal.name}
          detail={
            <>
              <Money cents={goal.currentCents} /> of <Money cents={goal.targetCents} />
            </>
          }
          end={<ProgressRing percent={goal.percent} label={`${goal.name} reached`} size={40} />}
        />
      ))}
    />
  )
}
