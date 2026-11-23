// A trip budget in one form: getting there, a place to stay, food per day and
// things to do. Saving a new one makes one goal named for the trip, set
// aside for by the day it starts; saving a planned one changes it, and takes
// the trip's days as they are now, in case its event moved.

import { useState, type FormEvent } from 'react'
import type { TripDetail } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { AmountNote, useAmountField } from '../../components/AmountNote'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { amountNote, type AmountRules } from '../../lib/amountNote'
import { SAVE_FOR_NAMES } from '../../lib/calendar'
import { parseMoney } from '../../lib/format'

const PARTS = [
  { key: 'travelCents', label: 'Getting there' },
  { key: 'stayCents', label: 'Place to stay' },
  { key: 'foodPerDayCents', label: 'Food per day' },
  { key: 'activitiesCents', label: 'Things to do' },
] as const

type PartKey = (typeof PARTS)[number]['key']
type Amounts = Record<PartKey, string>

/** What a part takes, as the server does: never negative, and no typo's worth of zeros. */
const PART_RULES: AmountRules = { min: 0, max: 10_000_000, rangeNote: 'Use $0 to $100,000.' }

/** A part's amount as typed: blank or unreadable is no amount yet. */
const centsOf = (text: string) => Math.max(0, parseMoney(text) ?? 0)

/** The fields to start from: blank for a new budget, its parts for one planned. */
function startingAmounts(budget: TripDetail['budget']): Amounts {
  const typed = (cents: number | undefined) => (cents ? String(cents / 100) : '')
  return {
    travelCents: typed(budget?.travelCents),
    stayCents: typed(budget?.stayCents),
    foodPerDayCents: typed(budget?.foodPerDayCents),
    activitiesCents: typed(budget?.activitiesCents),
  }
}

/** One part's field, with the note it shows when what was typed can't be saved. */
function PartField({
  label,
  text,
  onChange,
}: {
  label: string
  text: string
  onChange: (text: string) => void
}) {
  const field = useAmountField(text, PART_RULES)
  return (
    <label className="field">
      {label}
      <input
        className="input"
        inputMode="decimal"
        placeholder="0"
        {...field.inputProps}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      <AmountNote id={field.id} text={field.shown} fit />
    </label>
  )
}

export function TripBudgetForm({ trip, onDone }: { trip: TripDetail; onDone?: () => void }) {
  const { budget } = trip
  const create = useActionMutation('create_trip_budget')
  const update = useActionMutation('update_trip_budget')
  const save = budget ? update : create
  // A new budget starts named by its kind, never the event's title, which can hold a person's name.
  const [name, setName] = useState(budget?.name ?? SAVE_FOR_NAMES.trip)
  const [amounts, setAmounts] = useState(() => startingAmounts(budget))
  const parts = {
    travelCents: centsOf(amounts.travelCents),
    stayCents: centsOf(amounts.stayCents),
    foodPerDayCents: centsOf(amounts.foodPerDayCents),
    activitiesCents: centsOf(amounts.activitiesCents),
  }
  const totalCents =
    parts.travelCents + parts.stayCents + parts.foodPerDayCents * trip.days + parts.activitiesCents
  // An amount that can't be read keeps Save off, rather than saving as nothing.
  const unreadable = PARTS.some((part) => amountNote(amounts[part.key], PART_RULES) !== null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (unreadable) return
    const plan = { name, startsOn: trip.startsOn, endsOn: trip.endsOn, ...parts }
    if (budget) update.mutate({ ...plan, goalId: budget.goalId }, { onSuccess: onDone })
    else create.mutate(plan, { onSuccess: onDone })
  }

  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={budget ? 'Change the trip budget' : 'Plan a trip budget'}
    >
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="trip-parts">
        {PARTS.map((part) => (
          <PartField
            key={part.key}
            label={part.label}
            text={amounts[part.key]}
            onChange={(text) => setAmounts((a) => ({ ...a, [part.key]: text }))}
          />
        ))}
      </div>
      <div className="row-between wrap">
        <span className="small muted">
          <Money cents={totalCents} /> in all, as one goal set aside for by the day you leave.
        </span>
        <span className="row">
          {onDone && budget && (
            <button type="button" className="btn" onClick={onDone}>
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="btn primary"
            disabled={totalCents <= 0 || unreadable || save.isPending}
          >
            {budget ? 'Save' : 'Make it a goal'}
          </button>
        </span>
      </div>
      <ErrorNote error={save.error} />
    </form>
  )
}
