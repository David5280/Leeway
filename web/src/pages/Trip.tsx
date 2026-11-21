// One trip: what it cost, by part (getting there, a place to stay, food and
// things to do), and the transactions that make it up.

import { Link, useParams } from 'react-router-dom'
import type { TripDetail } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { dayRange } from '../lib/calendar'
import { TRIP_PART_NAMES, tripName } from '../lib/trips'

const STATUS = { upcoming: 'Coming up', under_way: 'Under way', past: 'Done' } as const
const PARTS = ['travel', 'stay', 'food', 'activities'] as const

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
  return (
    <Card static="list" label="Transactions" className="stack-sm">
      <h2>Transactions</h2>
      {trip.transactions.length === 0 && <p className="empty">Nothing spent on it yet.</p>}
      {trip.transactions.map((tx) => (
        <div key={tx.id} className="list-row">
          <span className="num small muted" style={{ width: 56, flex: 'none' }}>
            {shortDate(tx.date, settings.locale)}
          </span>
          <span className="grow ellipsis" style={{ minWidth: 0 }}>
            {tx.displayName}
          </span>
          <Money cents={tx.amountCents} sign="transaction" precision="cents" />
        </div>
      ))}
    </Card>
  )
}

export function TripPage() {
  const { start = '', end = '' } = useParams()
  const { settings } = useApp()
  const trip = useAction('get_trip', { startsOn: start, endsOn: end })
  if (!trip.data) {
    return (
      <Shell>
        <LoadingOrError error={trip.error} />
      </Shell>
    )
  }
  const detail = trip.data
  return (
    <Shell>
      <Link to="/plan/ahead" className="linkbtn row" style={{ gap: 4 }}>
        <Icon name="back" size={16} /> Coming up
      </Link>
      <div>
        <h1>{tripName(detail)}</h1>
        <span className="muted">
          {dayRange(detail, settings.locale)}, {detail.days} {detail.days === 1 ? 'day' : 'days'}.{' '}
          {STATUS[detail.status]}
        </span>
      </div>
      <p>
        <Money cents={detail.totalCents} size="lg" /> spent so far
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
