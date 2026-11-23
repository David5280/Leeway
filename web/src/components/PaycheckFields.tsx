// A paycheck budget period's schedule: how often pay lands and a payday to
// count from. When the paychecks show the schedule (get_pay's period), it is
// said in a line instead of asked, with Change to open the fields.

import { useState } from 'react'
import type { Settings } from '../api/client'
import { addDays, dateParts, daysBetween } from '../lib/dates'
import { cadenceLabel, PAY_CADENCE_WORDS } from '../pages/plan/payday/payText'
import { Setting } from './ui'

export type PaycheckPeriod = Extract<Settings['period'], { kind: 'paycheck' }>

type Frequency = PaycheckPeriod['frequency']

/** The pay cadence each frequency is, for its words (payText.ts), in the order the picker shows. */
const CADENCE_OF = {
  weekly: 'week',
  biweekly: 'biweek',
  semimonthly: 'semimonth',
  monthly: 'month',
} as const satisfies Record<Frequency, keyof typeof PAY_CADENCE_WORDS>

const FREQUENCIES = Object.keys(CADENCE_OF) as Frequency[]

function dayNumber(text: string, max: number): number {
  const value = Math.round(Number(text))
  return Number.isFinite(value) ? Math.min(max, Math.max(1, value)) : 1
}

/** Days between paydays for the frequencies that step by whole weeks. */
const STEP_DAYS: Partial<Record<Frequency, number>> = { weekly: 7, biweekly: 14 }

/** The day of the month a monthly payday keeps: its own, or the month's end as 31 (any length). */
function monthlyDay(date: string): number {
  return dateParts(addDays(date, 1)).day === 1 ? 31 : dateParts(date).day
}

/**
 * Whether a period keeps the found schedule. The found one counts from the
 * newest payday, so a saved period counted from an older payday on the same
 * schedule is the same: whole steps apart, or the same day of the month.
 */
export function sameSchedule(a: PaycheckPeriod, b: PaycheckPeriod): boolean {
  if (a.frequency !== b.frequency) return false
  if (a.frequency === 'semimonthly') {
    return String(a.semimonthlyDays ?? [1, 15]) === String(b.semimonthlyDays ?? [1, 15])
  }
  const step = STEP_DAYS[a.frequency]
  if (!step) return monthlyDay(a.anchorDate) === monthlyDay(b.anchorDate)
  return daysBetween(a.anchorDate, b.anchorDate) % step === 0
}

/** The schedule in a line, with Change to open the fields. */
function FoundSchedule({ value, onChange }: { value: PaycheckPeriod; onChange: () => void }) {
  return (
    <p className="row wrap small" style={{ justifyContent: 'space-between' }}>
      <span>
        Paid <b>{PAY_CADENCE_WORDS[CADENCE_OF[value.frequency]]}</b>, going by your paychecks.
      </span>
      <button type="button" className="btn ghost small" onClick={onChange}>
        Change
      </button>
    </p>
  )
}

/** How often pay lands and when: the fields, or a line when the paychecks already say. */
export function PaycheckSchedule({
  value,
  found,
  onChange,
}: {
  value: PaycheckPeriod
  found: PaycheckPeriod | null
  onChange: (period: PaycheckPeriod) => void
}) {
  const [editing, setEditing] = useState(false)
  if (found && !editing && sameSchedule(value, found)) {
    return <FoundSchedule value={value} onChange={() => setEditing(true)} />
  }
  return <PaycheckFields value={value} onChange={onChange} />
}

/** Every field of a paycheck schedule. */
function PaycheckFields({
  value,
  onChange,
}: {
  value: PaycheckPeriod
  onChange: (period: PaycheckPeriod) => void
}) {
  return (
    <>
      <Setting label="Paid">
        <select
          className="input"
          aria-label="How often you are paid"
          value={value.frequency}
          onChange={(e) =>
            onChange({ ...value, frequency: e.target.value as typeof value.frequency })
          }
        >
          {FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {cadenceLabel(CADENCE_OF[frequency])}
            </option>
          ))}
        </select>
      </Setting>
      {value.frequency === 'semimonthly' ? (
        <Setting label="Paydays" hint="Days of the month">
          <div className="row">
            {[0, 1].map((i) => (
              <input
                key={i}
                className="input num"
                style={{ width: 72 }}
                type="number"
                min={1}
                max={31}
                aria-label={i === 0 ? 'First payday' : 'Second payday'}
                value={value.semimonthlyDays?.[i] ?? (i === 0 ? 1 : 15)}
                onChange={(e) => {
                  const days = [...(value.semimonthlyDays ?? [1, 15])] as [number, number]
                  days[i] = dayNumber(e.target.value, 31)
                  onChange({ ...value, semimonthlyDays: days })
                }}
              />
            ))}
          </div>
        </Setting>
      ) : (
        <Setting label="A recent payday" hint="Any one works; Leeway counts from it">
          <input
            className="input num"
            type="date"
            aria-label="A recent payday"
            value={value.anchorDate}
            onChange={(e) => e.target.value && onChange({ ...value, anchorDate: e.target.value })}
          />
        </Setting>
      )}
    </>
  )
}
