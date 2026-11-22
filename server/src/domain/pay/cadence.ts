// How often a payroll pays, read from paydays, and when it pays next. Pure.
//
// Every two weeks and twice a month both pay about every 14 to 16 days, so
// gap length alone cannot tell them apart. Two signs do:
// - a biweekly payroll keeps to a 14-day grid: every payday is a whole
//   number of fortnights from the others, give or take a holiday;
// - a semimonthly one keeps to two days of the month (semimonthly.ts), so it
//   drifts off any 14-day grid within a few paydays.
// Twice a month is read only once the paydays leave any 14-day grid by more
// than holidays explain (one payday more than a business day off it, or more
// of them a business day off than holidays move: one in OFF_GRID_EVERY) and
// a schedule fits them closely. Until then, paydays that also sit on a
// common schedule, as a biweekly job's first few paychecks can (or Jan 31,
// Feb 14 and Feb 28), fit both: they read as every two weeks, marked
// ambiguous, and what is built on them takes the cautious side of each
// (pay/current.ts).

import { daysBetween, toDayNumber, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import { nominalPayday } from './nominal.js'
import {
  bestSchedule,
  businessDayOnOrBefore,
  COMMON_SCHEDULES,
  nextSemimonthlyPayday,
  semimonthlyFit,
  STANDARD_SCHEDULE,
  type ScheduleFit,
  type SemimonthSchedule,
  weekdaysApart,
} from './semimonthly.js'

/** The pay cadences a payroll uses. */
export type PayCadence = Extract<Cadence, 'week' | 'biweek' | 'semimonth' | 'month'>

/** How often a payroll pays, and for twice a month, on which days. */
export interface PayPattern {
  cadence: PayCadence
  /** The two days of the month it pays on, or may: null unless twice a month fits. */
  schedule: SemimonthSchedule | null
  /**
   * True when the paydays fit every two weeks and twice a month alike: read
   * as every two weeks (the cadence), with `schedule` the twice-a-month reading.
   */
  ambiguous: boolean
}

/** About how many days apart each cadence's paydays are, at most. */
export const CYCLE_DAYS: Record<Cadence, number> = {
  week: 7,
  biweek: 14,
  semimonth: 16,
  month: 31,
  quarter: 92,
  year: 366,
}

/** Gaps this long, in the middle, read as each cadence; others say nothing. */
const GAP_RANGES = { week: [5, 9], fortnight: [10, 19], month: [26, 35] } as const

const FORTNIGHT = 14

const within = (value: number, [least, most]: readonly [number, number]) =>
  value >= least && value <= most

/**
 * How far a biweekly payroll may move a payday off its grid: a business day,
 * for a holiday or a late posting. It keeps its weekday otherwise, so
 * paydays that do not are ones a 14-day grid cannot explain.
 */
export const GRID_SLACK = 1

/**
 * A biweekly payroll may move about one payday in this many off its grid:
 * a Monday payroll meets a holiday every few paydays (MLK Day, Presidents'
 * Day, Memorial Day and so on), a Friday one a few times a year.
 */
export const OFF_GRID_EVERY = 4

/** How many of `count` paydays a biweekly payroll may move off its grid: at least one. */
export const offGridAllowed = (count: number) => Math.max(1, Math.floor(count / OFF_GRID_EVERY))

/** How paydays sit off a 14-day grid anchored on one of them. */
interface GridFit {
  /** Business days off, added up. */
  offBy: number
  /** Paydays off it at all. */
  offCount: number
}

/**
 * The 14-day grids, one per payday as anchor, that every payday sits within
 * GRID_SLACK business days of, however many are off them.
 */
function gridFits(dates: IsoDate[]): GridFit[] {
  const days = dates.map(toDayNumber)
  return days.flatMap((anchor) => {
    const offs = days.map((day) => {
      const fortnights = Math.round((day - anchor) / FORTNIGHT)
      return weekdaysApart(day, anchor + fortnights * FORTNIGHT)
    })
    if (Math.max(...offs) > GRID_SLACK) return []
    const offBy = offs.reduce((sum, off) => sum + off, 0)
    return [{ offBy, offCount: offs.filter((off) => off > 0).length }]
  })
}

/**
 * The least business days off, added up, of the grids a biweekly payroll
 * could keep to: none off by more than GRID_SLACK, and no more off at all
 * than offGridAllowed. Null when none fits.
 */
function closestGrid(fits: GridFit[], count: number): number | null {
  const kept = fits.filter((fit) => fit.offCount <= offGridAllowed(count))
  return kept.length ? Math.min(...kept.map((fit) => fit.offBy)) : null
}

/**
 * How far paydays sit off a 14-day grid, in business days added up, when
 * they keep to it as a biweekly payroll does: none more than GRID_SLACK off,
 * and no more of them off than offGridAllowed, for some anchor among them.
 * Null when they do not. Business days alone would let a grid anchored on a
 * Monday take every Friday as a day off it, so how many are off counts too.
 */
export function gridOffBy(dates: IsoDate[]): number | null {
  return closestGrid(gridFits(dates), dates.length)
}

/**
 * How much closer, in business days, a 14-day grid must fit than a
 * semimonthly schedule to settle on every two weeks; any less and the
 * paydays fit both.
 */
const CLEARLY_CLOSER = 2

const BIWEEKLY: PayPattern = { cadence: 'biweek', schedule: null, ambiguous: false }

/** Most business days off, in all, two paydays may be and still fit a schedule. */
const PAIR_OFF_BY = 1

/**
 * Most business days off a schedule, per payday on it on average, that still
 * reads as twice a month: a semimonthly payroll is off only for a holiday, a
 * late posting or a 28th read as the month's end, where a biweekly one
 * drifts up to PAYDAY_SLACK days off any.
 */
const SCHEDULE_OFF_PER_PAYDAY = 1

/**
 * Two paydays, one gap: any two days half a month apart fit some schedule,
 * so they fit twice a month only when both land on a common schedule's
 * days, a business day off at most. One gap is too little to settle on
 * either, so a pair that fits reads as both, and one that does not as every
 * two weeks.
 */
function pairPattern(dates: IsoDate[]): PayPattern {
  const fit = bestSchedule(dates, COMMON_SCHEDULES)
  const onSchedule = fit.matched === 2 && fit.bothDays && fit.offBy <= PAIR_OFF_BY
  return onSchedule ? { cadence: 'biweek', schedule: fit.schedule, ambiguous: true } : BIWEEKLY
}

const semimonthly = (fit: ScheduleFit): PayPattern => ({
  cadence: 'semimonth',
  schedule: fit.schedule,
  ambiguous: false,
})

/**
 * Paydays a biweekly grid explains, `gridOffBy` business days off it: every
 * two weeks, and twice a month too while a common schedule fits them about
 * as closely. Some schedule of the many possible fits almost any few Fridays.
 */
function onGridPattern(dates: IsoDate[], gridOffBy: number): PayPattern {
  const common = semimonthlyFit(dates, COMMON_SCHEDULES)
  if (!common || common.offBy - gridOffBy >= CLEARLY_CLOSER) return BIWEEKLY
  return { cadence: 'biweek', schedule: common.schedule, ambiguous: true }
}

/**
 * Paydays each within a business day of a grid, `gridOffBy` off it, only
 * more of them moved than holidays usually move: as a Monday payroll meets
 * MLK Day and Presidents' Day a month apart. Twice a month once a common
 * schedule takes every one and fits clearly closer. Both while some
 * schedule, common or not, takes every one about as closely: an uncommon
 * one alone never settles it, since one of the many fits almost any few
 * paydays. Else every two weeks.
 */
function nearGridPattern(dates: IsoDate[], gridOffBy: number): PayPattern {
  const takesEvery = (fit: ScheduleFit | null): fit is ScheduleFit => fit?.matched === dates.length
  const common = semimonthlyFit(dates, COMMON_SCHEDULES)
  if (takesEvery(common) && gridOffBy - common.offBy >= CLEARLY_CLOSER) return semimonthly(common)
  const either = [common, semimonthlyFit(dates)]
    .filter(takesEvery)
    .find((fit) => fit.offBy - gridOffBy < CLEARLY_CLOSER)
  return either ? { cadence: 'biweek', schedule: either.schedule, ambiguous: true } : BIWEEKLY
}

/**
 * Paydays no grid comes near: twice a month when a schedule fits them
 * closely, else every two weeks, as paydays that fit neither are read.
 */
function offGridPattern(dates: IsoDate[]): PayPattern {
  const fit = semimonthlyFit(dates)
  const close = fit !== null && fit.offBy <= fit.matched * SCHEDULE_OFF_PER_PAYDAY
  return close ? semimonthly(fit) : BIWEEKLY
}

/**
 * Biweekly or semimonthly, for paydays about two weeks apart. Twice a month
 * is read only once a 14-day grid cannot explain the paydays.
 */
function fortnightlyPattern(dates: IsoDate[]): PayPattern {
  if (dates.length === 2) return pairPattern(dates)
  const fits = gridFits(dates)
  const grid = closestGrid(fits, dates.length)
  if (grid !== null) return onGridPattern(dates, grid)
  if (fits.length) return nearGridPattern(dates, Math.min(...fits.map((fit) => fit.offBy)))
  return offGridPattern(dates)
}

/** How often paydays (oldest first, two or more) come, or null when their gaps fit no cadence. */
export function payPattern(dates: IsoDate[]): PayPattern | null {
  const rough = roughCadence(dates)
  if (rough === 'semimonth') return fortnightlyPattern(dates)
  return rough && { cadence: rough, schedule: null, ambiguous: false }
}

/**
 * The cadence paydays roughly come at, by their gaps alone: about two weeks
 * reads as twice a month, the longer of the two cycles. Quick, for telling
 * where a payer's runs break; payPattern says which it really is.
 */
export function roughCadence(dates: IsoDate[]): PayCadence | null {
  const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date))
  if (gaps.length === 0) return null
  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
  if (within(middle, GAP_RANGES.week)) return 'week'
  if (within(middle, GAP_RANGES.fortnight)) return 'semimonth'
  if (within(middle, GAP_RANGES.month)) return 'month'
  return null
}

/** The cadence paydays come at, or null when their gaps fit none. */
export function cadenceOfDates(dates: IsoDate[]): PayCadence | null {
  return payPattern(dates)?.cadence ?? null
}

/**
 * The pattern for a cadence the owner gave (a paystub's), with the
 * semimonthly days read from the paydays seen so far.
 */
export function givenPattern(
  cadence: Cadence,
  dates: IsoDate[],
): {
  cadence: Cadence
  schedule: SemimonthSchedule | null
  ambiguous: false
} {
  if (cadence !== 'semimonth') return { cadence, schedule: null, ambiguous: false }
  const schedule = dates.length ? bestSchedule(dates).schedule : STANDARD_SCHEDULE
  return { cadence, schedule, ambiguous: false }
}

/**
 * The payday after the newest of `paydays` (oldest first, one or more) on
 * this cadence, the first one after today. Each is counted from the
 * payroll's usual day (nominal.ts), not from a payday a weekend or holiday
 * already moved, and then, like a payroll's, moved off a weekend to the
 * business day before (a monthly payday on the 13th is a Friday the 11th
 * when the 13th is a Sunday).
 */
export function nextPaydayAfter(
  paydays: IsoDate[],
  cadence: Cadence,
  today: IsoDate,
  schedule: SemimonthSchedule = STANDARD_SCHEDULE,
): IsoDate {
  if (cadence === 'semimonth') {
    let next = nextSemimonthlyPayday(paydays.at(-1)!, schedule)
    while (next <= today) next = nextSemimonthlyPayday(next, schedule)
    return next
  }
  const nominal = nominalPayday(paydays, cadence)
  for (let count = 1; ; count += 1) {
    const next = businessDayOnOrBefore(addCadence(nominal.date, cadence, count, nominal.dayOfMonth))
    if (next > today) return next
  }
}
