// The payday a payroll's cycle expects next after its newest payday, for
// telling whether a newer paycheck filled it (offCycle.ts). Pure.
//
// The cadence is read from the paydays on the cycle, or is one the owner
// gave, and the payday projected the way the next payday is (cadence.ts,
// nominal.ts), weekends and holidays included. Every two weeks is held to
// the cycle's own 14-day grid as well: a payday posted days late can sit
// nearer the usual weekday of the week off the grid (a Friday payroll's
// Jan 15 posted Wednesday Jan 20 is nearer Friday Jan 22), which alone
// would project the payday after it a week off.

import { addDays, daysBetween, toDayNumber, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { givenPattern, nextPaydayAfter, payPattern } from './cadence.js'
import { nominalPayday } from './nominal.js'
import type { SemimonthSchedule } from './semimonthly.js'

/** One way to read how a payroll pays: its cadence and, twice a month, its two days. */
export interface PayReading {
  cadence: Cadence
  schedule: SemimonthSchedule | null
}

const FORTNIGHT = 14

/**
 * The ways paydays (oldest first, two or more) may be read: the owner's
 * cadence when given; both every two weeks and twice a month while the
 * paydays fit both; none when they fit no cadence.
 */
export function readingsOf(paydays: IsoDate[], given: Cadence | null): PayReading[] {
  if (given) {
    const { cadence, schedule } = givenPattern(given, paydays)
    return [{ cadence, schedule }]
  }
  const pattern = payPattern(paydays)
  if (!pattern) return []
  if (!pattern.ambiguous) return [{ cadence: pattern.cadence, schedule: pattern.schedule }]
  return [
    { cadence: 'biweek', schedule: null },
    { cadence: 'semimonth', schedule: pattern.schedule },
  ]
}

/** The payday expected next after the newest of `paydays` (oldest first), read one way. */
export function expectedPaydayAfter(paydays: IsoDate[], reading: PayReading): IsoDate {
  if (reading.cadence === 'biweek') return nextOnFortnightGrid(paydays)
  return nextPaydayAfter(paydays, reading.cadence, paydays.at(-1)!, reading.schedule ?? undefined)
}

/** Days a payday lies from the nearest day on the 14-day grid through `onGrid`. */
function daysOffFortnight(payday: IsoDate, onGrid: IsoDate): number {
  const rest = (((toDayNumber(payday) - toDayNumber(onGrid)) % FORTNIGHT) + FORTNIGHT) % FORTNIGHT
  return Math.min(rest, FORTNIGHT - rest)
}

/**
 * The biweekly payday after the newest, as nextPaydayAfter counts it (the
 * first after it, from its usual day, moved off a holiday the payroll's
 * way), from the newest's usual day on the grid the paydays keep: the usual
 * weekday nearest the newest, or when the paydays sit the other week, the
 * one a week either side nearer it, the later on a tie.
 */
function nextOnFortnightGrid(paydays: IsoDate[]): IsoDate {
  const newest = paydays.at(-1)!
  const { date, roll } = nominalPayday(paydays, 'biweek')
  const offBy = (onGrid: IsoDate) =>
    paydays.reduce((sum, payday) => sum + daysOffFortnight(payday, onGrid), 0)
  let usual = date
  if (offBy(addDays(date, 7)) < offBy(date)) {
    const before = addDays(date, -7)
    const after = addDays(date, 7)
    usual = daysBetween(before, newest) < daysBetween(newest, after) ? before : after
  }
  for (let next = addDays(usual, FORTNIGHT); ; next = addDays(next, FORTNIGHT)) {
    if (roll(next) > newest) return roll(next)
  }
}
