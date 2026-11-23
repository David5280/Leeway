// Twice-a-month paydays. Pure.
//
// A semimonthly payroll pays on two fixed days of the month: the 15th and
// the last day, the 1st and the 15th, the 10th and the 25th, and so on. A
// payday that lands on a weekend or a holiday moves a day or few, usually to
// the business day before, and a bank can post it a day late. So a schedule
// is read from where most paydays fall, give or take PAYDAY_SLACK business
// days, never from every payday landing exactly. A few payrolls move weekend
// paydays to the business day after instead, so each schedule is fitted both
// ways; the next payday assumes the business day before until a payday shows
// otherwise (nominal.ts).

import {
  addDays,
  addMonths,
  clampedDate,
  dateParts,
  makeDate,
  toDayNumber,
  type IsoDate,
} from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'
import { businessDayOnOrBefore, weekdaysApart } from './businessDays.js'

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

/** The latest nominal day read as itself; one later is read as the month's last day. */
export const LATE_DAY = 28

/** The days a second payday this far into the month may be: itself, or the month's end from LATE_DAY on. */
function secondDays(day: number): number[] {
  if (day < LATE_DAY) return [day]
  return day === LATE_DAY ? [LATE_DAY, MONTH_END] : [MONTH_END]
}

/**
 * Every schedule worth trying: the common ones first, so paydays that fit
 * several read as the most likely, then every pair of days about half a
 * month apart.
 */
function candidateSchedules(): SemimonthSchedule[] {
  const all = [...COMMON_SCHEDULES]
  const gaps = Array.from(
    { length: HALF_MONTH.most - HALF_MONTH.least + 1 },
    (_, index) => HALF_MONTH.least + index,
  )
  for (let first = 1; first <= 16; first += 1) {
    for (const second of gaps.flatMap((gap) => secondDays(first + gap))) {
      if (!all.some((s) => s.first === first && s.second === second)) all.push({ first, second })
    }
  }
  return all
}

const CANDIDATES = candidateSchedules()

/**
 * A month's first day as a day number, and its length (months past 12 or
 * below 1 roll the year): a nominal day in it is the first plus the day,
 * clamped to the length, less one.
 */
function monthSpan(year: number, month: number): { first: number; length: number } {
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { first: Date.UTC(year, month - 1, 1) / DAY_MS, length }
}

/**
 * Where a payday sits against one nominal day, each less than zero when
 * before it, paid early: in business days for a payroll that moves a
 * weekend payday to the business day before (Friday for a Sunday is 0
 * off), and for one that moves it after (Monday for a Sunday is 0 off),
 * and in calendar days.
 */
interface Off {
  before: number
  after: number
  days: number
}

/** Signed business days from a nominal day to a payday, for a payroll that moves weekend paydays before it. */
function businessOff(at: number, nominal: number): number {
  return at < nominal ? -weekdaysApart(at, nominal) : weekdaysApart(at, nominal)
}

/**
 * Where a date sits against the nearest time each nominal day comes round,
 * in its month or either side, by day. The date is read once for them all,
 * since a schedule search asks of every day of the month.
 */
function offDays(date: IsoDate, days: Iterable<number>): Map<number, Off> {
  const { year, month } = dateParts(date)
  const at = toDayNumber(date)
  const months = [-1, 0, 1].map((shift) => monthSpan(year, month + shift))
  const offs = new Map<number, Off>()
  for (const day of days) {
    const nominal = months
      .map(({ first, length }) => first + Math.min(day, length) - 1)
      .reduce((nearest, each) => (Math.abs(each - at) < Math.abs(nearest - at) ? each : nearest))
    // Counting a day earlier turns business days after a weekend into ones before it.
    const after = businessOff(at - 1, nominal - 1)
    offs.set(day, { before: businessOff(at, nominal), after, days: at - nominal })
  }
  return offs
}

/** How well paydays fit a schedule: how many land on it, and how far off those are in all. */
export interface ScheduleFit {
  schedule: SemimonthSchedule
  /** Paydays within PAYDAY_SLACK business days of one of its two days. */
  matched: number
  /** Business days off, added up over the paydays that matched. */
  offBy: number
  /** Of those, the business days paydays landed after their day, posted late. */
  lateBy: number
  /** Calendar days the paydays that matched landed after their days, less those before. */
  drift: number
  /** Whether both days of the schedule were paid on at least once. */
  bothDays: boolean
}

/**
 * Where each payday sits against every day the candidates pay on: worked
 * out once, so trying each schedule only looks them up.
 */
function offsByDay(dates: IsoDate[], candidates: readonly SemimonthSchedule[]): Map<number, Off>[] {
  const days = new Set(candidates.flatMap((schedule) => [schedule.first, schedule.second]))
  return dates.map((date) => offDays(date, days))
}

function fitOf(
  offs: Map<number, Off>[],
  schedule: SemimonthSchedule,
  roll: 'before' | 'after',
): ScheduleFit {
  const fit = { schedule, matched: 0, offBy: 0, lateBy: 0, drift: 0, bothDays: false }
  const hit = { first: false, second: false }
  for (const off of offs) {
    const first = off.get(schedule.first)!
    const second = off.get(schedule.second)!
    const onFirst = Math.abs(first[roll]) <= Math.abs(second[roll])
    const nearest = onFirst ? first : second
    if (Math.abs(nearest[roll]) > PAYDAY_SLACK) continue
    fit.matched += 1
    fit.offBy += Math.abs(nearest[roll])
    fit.lateBy += Math.max(nearest[roll], 0)
    fit.drift += nearest.days
    hit[onFirst ? 'first' : 'second'] = true
  }
  return { ...fit, bothDays: hit.first && hit.second }
}

/**
 * Whether a fit beats another: more matched, then less off, then less of it
 * late, then the paydays further before their days. A schedule the paydays
 * keep as well either way is the later one, the cautious reading, since a
 * payday lands on or before its day: Friday Jan 31 for a Saturday the 1st
 * reads as the 1st, not the month's end.
 */
function fitsBetter(fit: ScheduleFit, than: ScheduleFit): boolean {
  if (fit.matched !== than.matched) return fit.matched > than.matched
  if (fit.offBy !== than.offBy) return fit.offBy < than.offBy
  if (fit.lateBy !== than.lateBy) return fit.lateBy < than.lateBy
  return fit.drift < than.drift
}

/**
 * The schedule most paydays fit, of `candidates` (every likely schedule by
 * default), with weekend paydays moved before or after, whichever fits
 * them: the one that fits best, the first of the candidates on a tie, and
 * moved before on a tie, as most payrolls move them.
 */
export function bestSchedule(
  dates: IsoDate[],
  candidates: readonly SemimonthSchedule[] = CANDIDATES,
): ScheduleFit {
  const offs = offsByDay(dates, candidates)
  let best = fitOf(offs, candidates[0]!, 'before')
  for (const schedule of candidates) {
    for (const roll of ['before', 'after'] as const) {
      const fit = fitOf(offs, schedule, roll)
      if (fitsBetter(fit, best)) best = fit
    }
  }
  return best
}

/**
 * The schedule paydays keep to, of `candidates` (every likely schedule by
 * default), or null when they do not read as twice a month: more than half
 * of them on it, and, with two or more, both of its days paid on.
 */
export function semimonthlyFit(
  dates: IsoDate[],
  candidates: readonly SemimonthSchedule[] = CANDIDATES,
): ScheduleFit | null {
  const fit = bestSchedule(dates, candidates)
  const majority = fit.matched * 2 > dates.length
  const bothDays = dates.length < 2 || fit.bothDays
  return majority && bothDays ? fit : null
}

/** A schedule's nominal days, unmoved, from the month before a date's to the month after. */
function scheduleDaysAround(date: IsoDate, schedule: SemimonthSchedule): IsoDate[] {
  const { year, month } = dateParts(date)
  return [-1, 0, 1].flatMap((shift) =>
    [schedule.first, schedule.second].map((day) => clampedDate(year, month + shift, day)),
  )
}

/** The schedule day a payday was meant for: the nominal day nearest it. */
export function nearestScheduleDay(payday: IsoDate, schedule: SemimonthSchedule): IsoDate {
  const at = toDayNumber(payday)
  const distance = (date: IsoDate) => Math.abs(toDayNumber(date) - at)
  return scheduleDaysAround(payday, schedule).reduce((nearest, date) =>
    distance(date) < distance(nearest) ? date : nearest,
  )
}

/** The schedule's next nominal day after a date, unmoved. */
export function nextScheduleDay(after: IsoDate, schedule: SemimonthSchedule): IsoDate {
  return scheduleDaysAround(addDays(after, 1), schedule).find((date) => date > after)!
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
