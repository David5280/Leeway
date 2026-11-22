// Where a payroll means to pay, before a weekend or a holiday moves a
// payday. Pure.
//
// A payday paid early (a Thursday for a Friday holiday, Friday the 13th for
// a Sunday the 15th) or posted late (the Monday after) is the payroll's
// usual day moved, so the next payday is projected from that usual day and
// moved only once, never from the moved one: from Friday Nov 13, a monthly
// payroll on the 15th pays next on Tuesday Dec 15, not on Friday Dec 11.

import {
  addDays,
  clampedDate,
  dateParts,
  dayOfWeek,
  toDayNumber,
  type IsoDate,
} from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { MONTH_END, offDay } from './semimonthly.js'

/** A payroll's usual payday nearest its newest one, and the day of the month it repeats on. */
export interface NominalPayday {
  date: IsoDate
  /** For monthly and longer cadences, the day each month's payday is meant for. */
  dayOfMonth?: number
}

/** Most days a weekday may lie from the newest payday either way: half a week. */
const HALF_WEEK = 3

/** The weekday most paydays land on, the newest's on a tie. */
function usualWeekday(paydays: IsoDate[]): number {
  const counts = new Map<number, number>()
  for (const payday of paydays) {
    counts.set(dayOfWeek(payday), (counts.get(dayOfWeek(payday)) ?? 0) + 1)
  }
  let usual = dayOfWeek(paydays.at(-1)!)
  for (const [weekday, count] of counts) if (count > counts.get(usual)!) usual = weekday
  return usual
}

/** The newest payday moved to the usual weekday, the nearer way: Thursday's holiday payday to its Friday. */
function onUsualWeekday(paydays: IsoDate[]): IsoDate {
  const newest = paydays.at(-1)!
  const ahead = (usualWeekday(paydays) - dayOfWeek(newest) + 7) % 7
  // More than half a week ahead is nearer behind: a late Monday posting goes back to its Friday.
  return addDays(newest, ahead <= HALF_WEEK ? ahead : ahead - 7)
}

/**
 * The day of the month paydays sit fewest business days off in all, the
 * newest's own day on a tie: Aug 14, Sep 15, Oct 15 and Nov 13 are the 15th,
 * each moved off a weekend, and Oct 30 for a Sunday the 1st is the 1st.
 */
function usualDayOfMonth(paydays: IsoDate[]): number {
  const offBy = (day: number) => paydays.reduce((sum, payday) => sum + offDay(payday, day), 0)
  let usual = dateParts(paydays.at(-1)!).day
  let least = offBy(usual)
  for (let day = 1; day <= MONTH_END; day += 1) {
    const off = offBy(day)
    if (off < least) [usual, least] = [day, off]
  }
  return usual
}

/** The usual day nearest the newest payday: in its month, or the one either side. */
function nearestDayOfMonth(newest: IsoDate, dayOfMonth: number): IsoDate {
  const { year, month } = dateParts(newest)
  const distance = (date: IsoDate) => Math.abs(toDayNumber(date) - toDayNumber(newest))
  return [-1, 0, 1]
    .map((shift) => clampedDate(year, month + shift, dayOfMonth))
    .reduce((nearest, date) => (distance(date) < distance(nearest) ? date : nearest))
}

/**
 * The usual payday nearest the newest of `paydays` (oldest first, one or
 * more): on the weekday they keep for weekly and biweekly pay, else on the
 * day of the month they keep.
 */
export function nominalPayday(paydays: IsoDate[], cadence: Cadence): NominalPayday {
  if (cadence === 'week' || cadence === 'biweek') return { date: onUsualWeekday(paydays) }
  const dayOfMonth = usualDayOfMonth(paydays)
  return { date: nearestDayOfMonth(paydays.at(-1)!, dayOfMonth), dayOfMonth }
}
