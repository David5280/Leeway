// A trip budget before you go, in one form: getting there, a place to stay,
// food per day and things to do. Saving makes one goal named for the trip,
// set aside for by the day it starts.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../api/hooks'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { parseMoney } from '../../lib/format'

const PARTS = [
  { key: 'travelCents', label: 'Getting there' },
  { key: 'stayCents', label: 'Place to stay' },
  { key: 'foodPerDayCents', label: 'Food per day' },
  { key: 'activitiesCents', label: 'Things to do' },
] as const

type PartKey = (typeof PARTS)[number]['key']

export function TripBudgetForm({
  name,
  startsOn,
  endsOn,
  days,
}: {
  name: string
  startsOn: string
  endsOn: string
  days: number
}) {
  const create = useActionMutation('create_trip_budget')
  const [title, setTitle] = useState(name)
  const [amounts, setAmounts] = useState<Record<PartKey, string>>({
    travelCents: '',
    stayCents: '',
    foodPerDayCents: '',
    activitiesCents: '',
  })
  const cents = (key: PartKey) => Math.max(0, parseMoney(amounts[key]) ?? 0)
  const totalCents =
    cents('travelCents') +
    cents('stayCents') +
    cents('foodPerDayCents') * days +
    cents('activitiesCents')

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      name: title,
      startsOn,
      endsOn,
      travelCents: cents('travelCents'),
      stayCents: cents('stayCents'),
      foodPerDayCents: cents('foodPerDayCents'),
      activitiesCents: cents('activitiesCents'),
    })
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Plan a trip budget">
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="trip-parts">
        {PARTS.map((part) => (
          <label key={part.key} className="field">
            {part.label}
            <input
              className="input"
              inputMode="decimal"
              placeholder="0"
              value={amounts[part.key]}
              onChange={(event) => setAmounts((a) => ({ ...a, [part.key]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="row-between wrap">
        <span className="small muted">
          <Money cents={totalCents} /> in all, as one goal set aside for by the day you leave.
        </span>
        <button
          type="submit"
          className="btn primary"
          disabled={totalCents <= 0 || create.isPending}
        >
          Make it a goal
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  )
}
