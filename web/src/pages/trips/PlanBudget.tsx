// Planning a coming trip's budget on its page: the form while none is
// planned, and a way to change the one that is, until the trip starts.

import { useState } from 'react'
import type { TripDetail } from '../../api/client'
import { Card } from '../../components/design/Card'
import { TripBudgetForm } from './TripBudgetForm'

export function PlanBudget({ trip }: { trip: TripDetail }) {
  const [changing, setChanging] = useState(false)
  if (trip.budget && !changing) {
    return (
      <button type="button" className="linkbtn small tap" onClick={() => setChanging(true)}>
        Change the budget
      </button>
    )
  }
  const title = trip.budget ? 'Change the trip budget' : 'Plan a trip budget'
  return (
    <Card static="form" label={title} className="stack">
      <h2>{title}</h2>
      <TripBudgetForm trip={trip} onDone={() => setChanging(false)} />
    </Card>
  )
}
