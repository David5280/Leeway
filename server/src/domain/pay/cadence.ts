// How often a payroll pays, read from paydays, and when it pays next. Pure.
//
// Every two weeks and twice a month both pay about every 14 to 16 days, so
// gap length alone cannot tell them apart. Two signs do:
// - a biweekly payroll keeps to a 14-day grid: every payday is a whole
//   number of fortnights from the others, give or take a holiday;
// - a semimonthly one keeps to two days of the month (semimonthly.ts), so it
//   drifts off any 14-day grid within a few paydays.
// Twice a month is read only once some payday sits off any 14-day grid by
// more than a holiday explains. Until then, paydays that also sit on a
// common schedule, as a biweekly job's first few paychecks can (or Jan 31,
// Feb 14 and Feb 28), fit both: they read as every two weeks, marked
// ambiguous, and what is built on them takes the cautious side of each
// (pay/current.ts).

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import {
  bestSchedule,
  businessDayOnOrBefore,
  businessDaysApart,
  COMMON_SCHEDULES,
  nextSemimonthlyPayday,
  semimonthlyFit,
  STANDARD_SCHEDULE,
  type SemimonthSchedule,
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
 * for a holiday, and only one payday in a few. It keeps its weekday
 * otherwise, so paydays that do not are ones a 14-day grid cannot explain.
 */
export const GRID_SLACK = 1

/**
 * How far paydays sit off a 14-day grid, in business days added up, when
 * they keep to it as a biweekly payroll does: all on it but one at most,
 * and that one within GRID_SLACK, for some anchor among them. Null when they
 * do not. Business days alone would let a grid anchored on a Monday take
 * every Friday as a day off it, so how many are off counts too.
 */
export function gridOffBy(dates: IsoDate[]): number | null {
  let best: number | null = null
  for (const anchor of dates) {
    const offs = dates.map((date) => {
      const fortnights = Math.round(daysBetween(anchor, date) / FORTNIGHT)
      return businessDaysApart(date, addDays(anchor, fortnights * FORTNIGHT))
    })
    const keeps = Math.max(...offs) <= GRID_SLACK && offs.filter((off) => off > 0).length <= 1
    const total = offs.reduce((sum, off) => sum + off, 0)
    if (keeps && (best === null || total < best)) best = total
  }
  return best
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

/**
 * Biweekly or semimonthly, for paydays about two weeks apart. Twice a month
 * is read only once a 14-day grid cannot explain some payday. While it can,
 * the paydays fit both only when a common schedule fits them about as
 * closely: some schedule of the many possible fits almost any few Fridays.
 */
function fortnightlyPattern(dates: IsoDate[]): PayPattern {
  if (dates.length === 2) return pairPattern(dates)
  const grid = gridOffBy(dates)
  if (grid === null) {
    const semi = semimonthlyFit(dates)
    return semi ? { cadence: 'semimonth', schedule: semi.schedule, ambiguous: false } : BIWEEKLY
  }
  const common = semimonthlyFit(dates, COMMON_SCHEDULES)
  if (!common || common.offBy - grid >= CLEARLY_CLOSER) return BIWEEKLY
  return { cadence: 'biweek', schedule: common.schedule, ambiguous: true }
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
 * The payday after `last` on this cadence, the first one after today. Each
 * is counted from `last` and, like a payroll's, moved off a weekend to the
 * business day before (a monthly payday on the 13th is a Friday the 11th
 * when the 13th is a Sunday).
 */
export function nextPaydayAfter(
  last: IsoDate,
  cadence: Cadence,
  today: IsoDate,
  schedule: SemimonthSchedule = STANDARD_SCHEDULE,
): IsoDate {
  if (cadence === 'semimonth') {
    let next = nextSemimonthlyPayday(last, schedule)
    while (next <= today) next = nextSemimonthlyPayday(next, schedule)
    return next
  }
  for (let count = 1; ; count += 1) {
    const next = businessDayOnOrBefore(addCadence(last, cadence, count))
    if (next > today) return next
  }
}
