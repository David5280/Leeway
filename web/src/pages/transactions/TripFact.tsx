// The trip a transaction is part of, as one more fact in its sheet: a link to
// the trip's page. Nothing shows when it is part of none.

import { Link } from 'react-router-dom'
import { useAction } from '../../api/hooks'
import { useApp } from '../../lib/app'
import { dayRange } from '../../lib/calendar'
import { tripName, tripPath } from '../../lib/trips'

export function TripFact({ id }: { id: string }) {
  const { settings } = useApp()
  const trip = useAction('trip_of_transaction', { id }).data
  if (!trip) return null
  return (
    <div>
      <dt>Trip</dt>
      <dd>
        <Link to={tripPath(trip)} className="linkbtn">
          {tripName(trip)}, {dayRange(trip, settings.locale)}
        </Link>
      </dd>
    </div>
  )
}
