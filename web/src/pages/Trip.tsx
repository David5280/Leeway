// One trip: what it cost, by part (getting there, a place to stay, food and
// things to do), against its budget when one was planned, and the
// transactions that make it up. A trip still ahead with no budget offers one.

import { Link, useParams } from 'react-router-dom'
import type { TripDetail } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { dayRange, SAVE_FOR_NAMES } from '../lib/calendar'
import { TRIP_PART_NAMES, tripName } from '../lib/trips'
import { TripBudgetForm } from './trips/TripBudgetForm'

const STATUS = { upcoming: 'Coming up', under_way: 'Under way', past: 'Done' } as const
const PARTS = ['travel', 'stay', 'food', 'activities'] as const

function Parts({ trip }: { trip: TripDetail }) {
  const { budget } = trip
  return (
    <Card static="list" label="By part" className="stack-sm">
      <div className="row-between wrap">
        <h2>By part</h2>
        {budget && (
          <span className={`small ${budget.leftCents < 0 ? 'over' : 'muted'}`}>
            <Money cents={Math.abs(budget.leftCents)} />{' '}
            {budget.leftCents < 0 ? 'over budget' : 'left of'}{' '}
            {budget.leftCents < 0 ? '' : <Money cents={budget.plannedCents} />}
          </span>
        )}
      </div>
      {PARTS.map((part) => (
        <div key={part} className="trip-part">
          <span>{TRIP_PART_NAMES[part]}</span>
          <span className="stack-sm" style={{ gap: 0 }}>
            <Money cents={trip.spentByPart[part]} />
            {budget && (
              <span className={`small ${budget.leftByPart[part] < 0 ? 'over' : 'muted'}`}>
                <Money cents={Math.abs(budget.leftByPart[part])} />{' '}
                {budget.leftByPart[part] < 0 ? 'over' : 'left'}
              </span>
            )}
          </span>
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
      {detail.status === 'upcoming' && !detail.budget && (
        <Card static="form" label="Plan a trip budget" className="stack">
          <h2>Plan a trip budget</h2>
          {/* The goal starts named by its kind, never the event's title, which can hold a person's name. */}
          <TripBudgetForm
            name={SAVE_FOR_NAMES.trip}
            startsOn={detail.startsOn}
            endsOn={detail.endsOn}
            days={detail.days}
          />
        </Card>
      )}
      <Parts trip={detail} />
      <Transactions trip={detail} />
    </Shell>
  )
}
