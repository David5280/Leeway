// Twice-a-month paydays. Pure.
//
// A semimonthly payroll pays on two fixed days of the month: the 15th and
// the last day, the 1st and the 15th, the 10th and the 25th, and so on. A
// payday that lands on a weekend or a holiday moves a day or few, usually to
// the business day before, and a bank can post it a day late. So a schedule
// is read from where most paydays fall, give or take PAYDAY_SLACK business
// days, never from every payday landing exactly.

import {
  addDays,
  addMonths,
  clampedDate,
  dateParts,
  dayOfWeek,
  makeDate,
  toDayNumber,
  type IsoDate,
} from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'

/** The nominal day that means a month's last day, whatever its length. */
export const MONTH_END = 31

/** The two days of the month a semimonthly payroll pays on; `second` may be MONTH_END. */
export interface SemimonthSchedule {
  first: number
  second: number
}

/** The most common schedule: the 15th and the month's last day. */
export const STANDARD_SCHEDULE: SemimonthSchedule = { first: 15, second: MONTH_END }

/** How many business days a payday may land off its nominal day and still count as on it. */
export const PAYDAY_SLACK = 3

/** The schedules most payrolls use, the 15th and the month's end first. */
export const COMMON_SCHEDULES: readonly SemimonthSchedule[] = [
  STANDARD_SCHEDULE,
  { first: 1, second: 15 },
  { first: 10, second: 25 },
]

/** A schedule's two days lie about half a month apart: this many days at least, and at most. */
const HALF_MONTH = { least: 13, most: 17 }

/** A nominal day this late or later is read as the month's last day. */
const LATE_DAY = 28

const isWeekend = (date: IsoDate) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6

/** The date, or the business day before it when it falls on a weekend. */
export function businessDayOnOrBefore(date: IsoDate): IsoDate {
  let day = date
  while (isWeekend(day)) day = addDays(day, -1)
  return day
}

/** 0 = Sunday through 6 = Saturday, for a day number (1970-01-01, day 0, was a Thursday). */
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7

/** Weekdays after day number `from` up to and including `to`, for `from` <= `to`. */
function weekdaysAfter(from: number, to: number): number {
  const span = to - from
  // Every whole week holds five; the days left over are counted one by one.
  let count = Math.floor(span / 7) * 5
  for (let day = from + 1 + Math.floor(span / 7) * 7; day <= to; day += 1) {
    const weekday = weekdayOf(day)
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

/**
 * Business days between two dates, either way round: the weekdays after the
 * earlier one up to and including the later. A Friday paycheck for a Sunday
 * payday is 0 apart; one on the Monday after is 1.
 */
export function businessDaysApart(a: IsoDate, b: IsoDate): number {
  const [from, to] = [toDayNumber(a), toDayNumber(b)].sort((x, y) => x - y) as [number, number]
  return weekdaysAfter(from, to)
}

/**
 * Every schedule worth trying: the common ones first, so a single payday
 * that fits several reads as the most likely, then every pair of days about
 * half a month apart.
 */
function candidateSchedules(): SemimonthSchedule[] {
  const all = [...COMMON_SCHEDULES]
  for (let first = 1; first <= 16; first += 1) {
    for (let gap = HALF_MONTH.least; gap <= HALF_MONTH.most; gap += 1) {
      const second = first + gap >= LATE_DAY ? MONTH_END : first + gap
      if (!all.some((s) => s.first === first && s.second === second)) all.push({ first, second })
    }
  }
  return all
}

const CANDIDATES = candidateSchedules()

/** The day number of a nominal day in a month (months past 12 or below 1 roll the year), clamped to its length. */
function nominalDay(year: number, month: number, day: number): number {
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Date.UTC(year, month - 1, Math.min(day, length)) / DAY_MS
}

/** Business days from a date to the nearest time a nominal day comes round, in its month or either side. */
function offDay(date: IsoDate, day: number): number {
  const { year, month } = dateParts(date)
  const at = toDayNumber(date)
  return Math.min(
    ...[-1, 0, 1].map((shift) => {
      const nominal = nominalDay(year, month + shift, day)
      return at <= nominal ? weekdaysAfter(at, nominal) : weekdaysAfter(nominal, at)
    }),
  )
}

/** How well paydays fit a schedule: how many land on it, and how far off those are in all. */
export interface ScheduleFit {
  schedule: SemimonthSchedule
  /** Paydays within PAYDAY_SLACK business days of one of its two days. */
  matched: number
  /** Business days off, added up over the paydays that matched. */
  offBy: number
  /** Whether both days of the schedule were paid on at least once. */
  bothDays: boolean
}

function fitOf(dates: IsoDate[], schedule: SemimonthSchedule): ScheduleFit {
  let matched = 0
  let offBy = 0
  const hit = { first: false, second: false }
  for (const date of dates) {
    const first = offDay(date, schedule.first)
    const second = offDay(date, schedule.second)
    const nearest = Math.min(first, second)
    if (nearest > PAYDAY_SLACK) continue
    matched += 1
    offBy += nearest
    hit[first <= second ? 'first' : 'second'] = true
  }
  return { schedule, matched, offBy, bothDays: hit.first && hit.second }
}

/**
 * The schedule most paydays fit, of `candidates` (every likely schedule by
 * default): the most matched, then the least off, the common ones winning a tie.
 */
export function bestSchedule(
  dates: IsoDate[],
  candidates: readonly SemimonthSchedule[] = CANDIDATES,
): ScheduleFit {
  let best = fitOf(dates, candidates[0]!)
  for (const schedule of candidates.slice(1)) {
    const fit = fitOf(dates, schedule)
    if (fit.matched > best.matched || (fit.matched === best.matched && fit.offBy < best.offBy)) {
      best = fit
    }
  }
  return best
}

/**
 * The schedule paydays keep to, or null when they do not read as twice a
 * month: more than half of them on it, and, with two or more, both of its
 * days paid on.
 */
export function semimonthlyFit(dates: IsoDate[]): ScheduleFit | null {
  const fit = bestSchedule(dates)
  const majority = fit.matched * 2 > dates.length
  const bothDays = dates.length < 2 || fit.bothDays
  return majority && bothDays ? fit : null
}

/** A schedule's paydays in one month, each moved off a weekend to the business day before. */
function paydaysIn(year: number, month: number, schedule: SemimonthSchedule): IsoDate[] {
  return [schedule.first, schedule.second].map((day) =>
    businessDayOnOrBefore(clampedDate(year, month, day)),
  )
}

/** The first payday on a schedule after a date. */
export function nextSemimonthlyPayday(after: IsoDate, schedule: SemimonthSchedule): IsoDate {
  const { year, month } = dateParts(after)
  const start = makeDate(year, month, 1)
  const candidates = [0, 1, 2].flatMap((shift) => {
    const { year: y, month: m } = dateParts(addMonths(start, shift))
    return paydaysIn(y, m, schedule)
  })
  return candidates.find((payday) => payday > after)!
}
