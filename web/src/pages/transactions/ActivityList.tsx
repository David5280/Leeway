// The transaction list: one compact row per transaction, grouped by day
// under a sticky header with the day's net. A row is a button that opens
// the transaction's sheet; everything it shows is read out in its label.

import type { ReactNode } from 'react'
import type { Category, Transaction } from '../../api/client'
import { CategoryIcon } from '../../components/design/CategoryIcon'
import { Money } from '../../components/design/Money'
import { StatusPill } from '../../components/design/StatusPill'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { relativeDay } from '../../lib/format'
import { amountSign, dayNet, isMove, rowLabel } from '../../lib/transactions'
import { groupByDay } from './filters'

export function ActivityList({
  transactions,
  categories,
  complete,
  onOpen,
}: {
  transactions: Transaction[]
  /** Every category, by id. */
  categories: Map<string, Category>
  /** False when older transactions are still to load, so the last day may be cut short. */
  complete: boolean
  onOpen: (tx: Transaction) => void
}) {
  const { settings } = useApp()
  const today = isoDaysAgo(0, settings.timeZone)
  const groups = groupByDay(transactions)
  const kindOf = (id: string | null) => (id ? (categories.get(id)?.kind ?? null) : null)
  return (
    <div className="act-days">
      {groups.map(([day, items], index) => {
        // A day cut off by the page end would show a net that is not the day's.
        const whole = complete || index < groups.length - 1
        return (
          <DayGroup
            key={day}
            label={relativeDay(day, today, settings.locale)}
            net={whole ? dayNet(items, kindOf) : null}
          >
            {items.map((tx) => (
              <ActivityRow
                key={tx.id}
                tx={tx}
                category={tx.categoryId ? categories.get(tx.categoryId) : undefined}
                onOpen={() => onOpen(tx)}
              />
            ))}
          </DayGroup>
        )
      })}
    </div>
  )
}

/** A day's header, sticky while its rows scroll by, and its rows on one card. */
function DayGroup({
  label,
  net,
  children,
}: {
  label: string
  /** What the day added up to, positive for money out; null to leave it out. */
  net: number | null
  children: ReactNode
}) {
  return (
    <section className="act-day" aria-label={label}>
      <h2 className="act-day-head">
        <span>{label}</span>
        {net !== null && net !== 0 && (
          // A day's net is quiet beside the rows; only a day with more in than out is green.
          <Money cents={net} sign="transaction" tone={net < 0 ? 'in' : 'muted'} />
        )}
      </h2>
      <ul className="act-rows">{children}</ul>
    </section>
  )
}

/** One transaction: category icon, clean name, account, and amount. */
export function ActivityRow({
  tx,
  category,
  onOpen,
}: {
  tx: Transaction
  category: Category | undefined
  onOpen: () => void
}) {
  const { exact } = useApp()
  const kind = category?.kind ?? null
  const moved = isMove(kind)
  return (
    <li>
      <button
        type="button"
        className="act-row"
        data-id={tx.id}
        aria-label={rowLabel(tx, category, exact(Math.abs(tx.amountCents)))}
        onClick={onOpen}
      >
        <CategoryIcon category={category} transfer={moved} />
        <span className="act-row-text">
          <span className="act-row-name">{tx.displayName}</span>
          <span className="act-row-sub">
            <span className="act-row-account">{tx.accountName}</span>
            {tx.pending && <StatusPill status="quiet" label="Pending" />}
            {tx.excluded && <StatusPill status="quiet" label="Not counted" />}
          </span>
        </span>
        <Money cents={tx.amountCents} sign={amountSign(kind)} className="act-row-amount" />
      </button>
    </li>
  )
}

/**
 * Where focus goes when the row a sheet was opened from has left the list:
 * the first of the rows that followed it that is still there, or else the
 * given heading.
 */
export function rowAfter(following: string[], heading: HTMLElement | null): HTMLElement | null {
  for (const id of following) {
    const row = document.querySelector<HTMLElement>(`.act-row[data-id="${id}"]`)
    if (row) return row
  }
  return heading
}
