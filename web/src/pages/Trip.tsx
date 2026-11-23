// One trip: what it cost, by part (getting there, a place to stay, food and
// things to do), and the transactions that make it up, each opening its sheet.
// Every state, an error or a trip not found included, leads back to Coming up.

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Transaction, TripDetail } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { dayRange } from '../lib/calendar'
import { TRIP_PART_NAMES, tripName } from '../lib/trips'
import { TransactionSheet } from './transactions/TransactionSheet'

const STATUS = { upcoming: 'Coming up', under_way: 'Under way', past: 'Done' } as const
const PARTS = ['travel', 'stay', 'food', 'activities'] as const

/** Back to the list of trips coming up, where a trip's page is opened from. */
function BackLink() {
  return (
    <Link to="/plan/ahead" className="linkbtn row trip-back">
      <Icon name="back" size={16} /> Coming up
    </Link>
  )
}

function Parts({ trip }: { trip: TripDetail }) {
  return (
    <Card static="list" label="By part" className="stack-sm">
      <h2>By part</h2>
      {PARTS.map((part) => (
        <div key={part} className="trip-part">
          <span>{TRIP_PART_NAMES[part]}</span>
          <Money cents={trip.spentByPart[part]} />
        </div>
      ))}
    </Card>
  )
}

function Transactions({ trip }: { trip: TripDetail }) {
  const { settings } = useApp()
  const categories = useAction('list_categories').data ?? []
  const [opened, setOpened] = useState<Transaction | null>(null)
  return (
    <>
      <Card static="list" label="Transactions" className="stack-sm">
        <h2>Transactions</h2>
        {trip.transactions.length === 0 && <p className="empty">Nothing spent on it yet.</p>}
        {trip.transactions.map((tx) => (
          <button key={tx.id} type="button" className="list-row" onClick={() => setOpened(tx)}>
            <span className="num small muted trip-date">{shortDate(tx.date, settings.locale)}</span>
            <span className="grow ellipsis">{tx.displayName}</span>
            <Money cents={tx.amountCents} sign="transaction" precision="cents" />
          </button>
        ))}
        {trip.moreTransactions && (
          <p className="small muted">
            Showing the newest {trip.transactions.length}. The totals count them all.
          </p>
        )}
      </Card>
      {opened && (
        <TransactionSheet
          key={opened.id}
          initial={opened}
          categories={categories}
          onOpen={setOpened}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  )
}

export function TripPage() {
  const { start = '', end = '' } = useParams()
  const { settings } = useApp()
  const trip = useAction('get_trip', { startsOn: start, endsOn: end })
  if (!trip.data) {
    return (
      <Shell>
        <BackLink />
        <LoadingOrError error={trip.error} />
      </Shell>
    )
  }
  const detail = trip.data
  return (
    <Shell>
      <BackLink />
      <div>
        <h1>{tripName(detail)}</h1>
        <span className="muted">
          {dayRange(detail, settings.locale)}, {detail.days} {detail.days === 1 ? 'day' : 'days'}.{' '}
          {STATUS[detail.status]}
        </span>
      </div>
      <p>
        {/* A trip still ahead or under way may cost more yet; a finished one is done. */}
        <Money cents={detail.totalCents} size="lg" />{' '}
        {detail.status === 'past' ? 'spent' : 'spent so far'}
        {detail.source !== 'spending' && (
          <span className="small muted">
            {' '}
            (its days, and travel booked in the two months before)
          </span>
        )}
      </p>
      <Parts trip={detail} />
      <Transactions trip={detail} />
    </Shell>
  )
}
