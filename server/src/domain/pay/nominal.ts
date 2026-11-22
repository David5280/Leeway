// Where a payroll means to pay, before a weekend or a holiday moves a
// payday, and so when it pays next. Pure.
//
// A payday paid early (a Thursday for a Friday holiday, Friday the 13th for
// a Sunday the 15th) or posted late (the Monday after) is the payroll's
// usual day moved, so the next payday is projected from that usual day and
// moved only once, never from the moved one: from Friday Nov 13, a monthly
// payroll on the 15th pays next on Tuesday Dec 15, not on Friday Dec 11.
//
// Payrolls move a payday earlier, to the business day before, far more often
// than later, so a payday before its usual day is the normal move and one
// after it a late posting. A payroll whose paydays mostly land after their
// usual day is one that pays the business day after, and is projected so.

import {
  addDays,
  clampedDate,
  dateParts,
  dayOfWeek,
  toDayNumber,
  type IsoDate,
} from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import {
  businessDayOnOrAfter,
  businessDayOnOrBefore,
  businessDaysApart,
  type Roll,
  weekdaysApart,
} from './businessDays.js'
import {
  LATE_DAY,
  MONTH_END,
  nearestScheduleDay,
  nextScheduleDay,
  type SemimonthSchedule,
} from './semimonthly.js'

/** A payroll's usual payday nearest its newest one, and how it repeats and moves. */
export interface NominalPayday {
  date: IsoDate
  /** For monthly and longer cadences, the day each month's payday is meant for. */
  dayOfMonth?: number
  /** How the payroll moves a payday off a weekend. */
  roll: Roll
}

/** A payday after its usual day weighs this many times one before it, a late posting being rarer. */
const LATE_WEIGHT = 2

/**
 * How a payroll moves paydays off a weekend, from where they landed against
 * the days they were meant for: after, when more landed after than before;
 * else before, as most payrolls move them, which is assumed until a payday
 * shows otherwise.
 */
function rollOf(paydays: IsoDate[], meantFor: (payday: IsoDate) => IsoDate): Roll {
  let early = 0
  let late = 0
  for (const payday of paydays) {
    const nominal = meantFor(payday)
    if (payday < nominal) early += 1
    if (payday > nominal) late += 1
  }
  return late > early ? businessDayOnOrAfter : businessDayOnOrBefore
}

/**
 * The newest payday moved to a weekday, the way fewer business days off,
 * forward on a tie: Thursday's holiday payday to its Friday, Friday's for a
 * Monday holiday to its Monday, and a Tuesday posted late back to its Friday.
 */
function movedTo(newest: IsoDate, weekday: number): IsoDate {
  const forward = addDays(newest, (weekday - dayOfWeek(newest) + 7) % 7)
  const back = addDays(forward, -7)
  return businessDaysApart(newest, back) < businessDaysApart(newest, forward) ? back : forward
}

/**
 * The newest payday moved to the weekday most paydays land on; on a tie,
 * to whichever comes later, since a payroll moves a payday earlier for a
 * holiday: Mondays paid on the Friday before for half of them are Mondays.
 */
function onUsualWeekday(paydays: IsoDate[]): IsoDate {
  const counts = new Map<number, number>()
  for (const payday of paydays) {
    counts.set(dayOfWeek(payday), (counts.get(dayOfWeek(payday)) ?? 0) + 1)
  }
  const most = Math.max(...counts.values())
  return [...counts]
    .filter(([, count]) => count === most)
    .map(([weekday]) => movedTo(paydays.at(-1)!, weekday))
    .reduce((later, date) => (date > later ? date : later))
}

/** A day of the month nearest a payday: in its month, or the one either side, clamped to each. */
function nearestDayOfMonth(payday: IsoDate, dayOfMonth: number): IsoDate {
  const { year, month } = dateParts(payday)
  const distance = (date: IsoDate) => Math.abs(toDayNumber(date) - toDayNumber(payday))
  return [-1, 0, 1]
    .map((shift) => clampedDate(year, month + shift, dayOfMonth))
    .reduce((nearest, date) => (distance(date) < distance(nearest) ? date : nearest))
}

/**
 * Days to count a payday's business days off from earlier, by how the
 * payroll moves weekend paydays: a Monday payday for a Sunday is a day off
 * for one that pays the Friday before, and none for one that pays the
 * Monday after, as counting from a day earlier makes it.
 */
const ROLL_SHIFT = { before: 0, after: 1 } as const

/** The days a monthly payroll may keep: the 1st to the 30th, or the month's end. */
const MONTH_DAYS = Array.from({ length: MONTH_END }, (_, index) => index + 1)

/**
 * How far a payday lies from a day of the month, in business days counted
 * `shift` days earlier (ROLL_SHIFT), a late one weighing more.
 */
function weightedOff(payday: IsoDate, dayOfMonth: number, shift: number): number {
  const at = toDayNumber(payday)
  const nominal = toDayNumber(nearestDayOfMonth(payday, dayOfMonth))
  const off = weekdaysApart(at - shift, nominal - shift)
  return at > nominal ? LATE_WEIGHT * off : off
}

/**
 * How much closer a 29th or 30th must fit than the month's end to read as
 * itself, in business days: a holiday on a month's last day makes a
 * month-end payroll look like one on the 30th, and the month's end is the
 * later, cautious reading.
 */
const MONTH_END_SLACK = 1

/**
 * The day of the month the paydays sit fewest business days off in all,
 * counted `shift` days earlier (ROLL_SHIFT), late ones weighing more, and
 * that total. On a tie, the day that comes later after the newest payday,
 * since a payday lands on or before its day: Aug 14, Sep 15, Oct 15 and
 * Nov 13 are the 15th; Oct 30 for a Sunday the 1st is the 1st; a last
 * business day paid early for Memorial Day is still the month's end. Days
 * that land on the same date, as a 30th and the month's end do in a short
 * month, go to the later, and so does a 29th or 30th within MONTH_END_SLACK.
 */
function closestDayOfMonth(paydays: IsoDate[], shift: number): { dayOfMonth: number; off: number } {
  const newest = paydays.at(-1)!
  let closest = { dayOfMonth: 1, off: Infinity, date: '' }
  for (const day of MONTH_DAYS) {
    const off = paydays.reduce((sum, payday) => sum + weightedOff(payday, day, shift), 0)
    const date = nearestDayOfMonth(newest, day)
    const nearMonthEnd =
      day === MONTH_END && closest.dayOfMonth > LATE_DAY && off <= closest.off + MONTH_END_SLACK
    // Taken as the month's end, a 29th or 30th keeps its own fit, to weigh one roll against the other.
    if (nearMonthEnd) closest = { dayOfMonth: day, off: Math.min(off, closest.off), date }
    else if (off < closest.off || (off === closest.off && date >= closest.date)) {
      closest = { dayOfMonth: day, off, date }
    }
  }
  return closest
}

/**
 * The day of the month the paydays keep, and how the payroll moves them off
 * a weekend: to the business day after only when that fits them closer,
 * since most payrolls pay the business day before.
 */
function usualDayOfMonth(paydays: IsoDate[]): { dayOfMonth: number; roll: Roll } {
  const before = closestDayOfMonth(paydays, ROLL_SHIFT.before)
  const after = closestDayOfMonth(paydays, ROLL_SHIFT.after)
  return after.off < before.off
    ? { dayOfMonth: after.dayOfMonth, roll: businessDayOnOrAfter }
    : { dayOfMonth: before.dayOfMonth, roll: businessDayOnOrBefore }
}

/**
 * The usual payday nearest the newest of `paydays` (oldest first, one or
 * more): on the weekday they keep for weekly and biweekly pay, else on the
 * day of the month they keep.
 */
export function nominalPayday(paydays: IsoDate[], cadence: Cadence): NominalPayday {
  if (cadence === 'week' || cadence === 'biweek') {
    // A weekday payroll never meets a weekend; a holiday it meets is not known here.
    return { date: onUsualWeekday(paydays), roll: businessDayOnOrBefore }
  }
  const { dayOfMonth, roll } = usualDayOfMonth(paydays)
  return { date: nearestDayOfMonth(paydays.at(-1)!, dayOfMonth), dayOfMonth, roll }
}

/**
 * The first payday on a schedule after today, counted on from the schedule
 * day the newest payday was meant for: Friday Jan 12 paid early for MLK Day
 * was the 15th's, so the next is Jan 31, never the 15th again. A weekend
 * payday moves by `roll`, by default the way the paydays show.
 */
export function nextScheduledPayday(
  paydays: IsoDate[],
  schedule: SemimonthSchedule,
  today: IsoDate,
  roll: Roll = rollOf(paydays, (payday) => nearestScheduleDay(payday, schedule)),
): IsoDate {
  let day = nextScheduleDay(nearestScheduleDay(paydays.at(-1)!, schedule), schedule)
  while (roll(day) <= today) day = nextScheduleDay(day, schedule)
  return roll(day)
}
