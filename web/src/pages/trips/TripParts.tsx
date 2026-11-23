// A trip's spending by part (getting there, a place to stay, food and things
// to do), each against its budget when one was planned, with what is left of
// the budget in all.

import type { TripDetail } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { TRIP_PART_NAMES } from '../../lib/trips'

const PARTS = ['travel', 'stay', 'food', 'activities'] as const

type Budget = NonNullable<TripDetail['budget']>

/** What is left of the whole budget ("$1,150 left of $1,850"), or how far over it went. */
function LeftInAll({ budget }: { budget: Budget }) {
  if (budget.leftCents < 0) {
    return (
      <span className="small over">
        <Money cents={-budget.leftCents} /> over budget
      </span>
    )
  }
  return (
    <span className="small muted">
      <Money cents={budget.leftCents} /> left of <Money cents={budget.plannedCents} />
    </span>
  )
}

/** What is left of one part ("$100 left"), or how far over it went. */
function LeftOfPart({ cents }: { cents: number }) {
  const over = cents < 0
  return (
    <span className={over ? 'small over' : 'small muted'}>
      <Money cents={Math.abs(cents)} /> {over ? 'over' : 'left'}
    </span>
  )
}

export function TripParts({ trip }: { trip: TripDetail }) {
  const { budget } = trip
  return (
    <Card static="list" label="By part" className="stack-sm">
      <div className="row-between wrap">
        <h2>By part</h2>
        {budget && <LeftInAll budget={budget} />}
      </div>
      {PARTS.map((part) => (
        <div key={part} className="trip-part">
          <span>{TRIP_PART_NAMES[part]}</span>
          <span className="stack-xs">
            <Money cents={trip.spentByPart[part]} />
            {budget && <LeftOfPart cents={budget.leftByPart[part]} />}
          </span>
        </div>
      ))}
    </Card>
  )
}
