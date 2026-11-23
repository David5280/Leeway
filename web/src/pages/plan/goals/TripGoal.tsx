// What a trip budget's goal adds to its card: the way to its trip's page,
// where its amount and days change; a word when its trip is gone from the
// calendar; and, once the trip is done or gone, a way to close the goal.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Goal } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote } from '../../../components/ui'
import { tripPath } from '../../../lib/trips'

/** Closing deletes the goal and its budget, so it asks once before it does. */
function CloseGoal({ goal }: { goal: Goal }) {
  const [asking, setAsking] = useState(false)
  const remove = useActionMutation('delete_goal')
  if (!asking) {
    return (
      <button type="button" className="linkbtn small" onClick={() => setAsking(true)}>
        Close goal
      </button>
    )
  }
  return (
    <span className="row wrap">
      <span className="small muted">Its trip budget goes too.</span>
      <button type="button" className="btn" onClick={() => setAsking(false)}>
        Keep
      </button>
      <button
        type="button"
        className="btn danger"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ id: goal.id })}
      >
        Close
      </button>
      <ErrorNote error={remove.error} />
    </span>
  )
}

export function TripGoal({ goal }: { goal: Goal }) {
  const { trip } = goal
  if (!trip) return null
  const closable = goal.status === 'trip_done' || !trip.onCalendar
  return (
    <div className="row-between wrap">
      {trip.onCalendar ? (
        <Link to={tripPath(trip)} className="small">
          Open the trip
        </Link>
      ) : (
        <span className="small warn">
          Its trip is no longer on your calendar. Put it back to keep this budget, or close the
          goal.
        </span>
      )}
      {closable && <CloseGoal goal={goal} />}
    </div>
  )
}
