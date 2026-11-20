// How often a payroll pays, read from paydays, and when it pays next. Pure.
//
// Every two weeks and twice a month both pay about every 14 to 16 days, so
// gap length alone cannot tell them apart. Two signs do:
// - a biweekly payroll keeps to a 14-day grid: every payday is a whole
//   number of fortnights from the others, give or take a holiday;
// - a semimonthly one keeps to two days of the month (semimonthly.ts), so it
//   drifts off any 14-day grid within a few paydays.
// When both fit, as over a few paydays they can, the closer fit wins, and a
// dead heat goes to twice a month: paydays that land exactly on a
// semimonthly schedule (Jan 31, Feb 14, Feb 28) are far likelier to be one.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import {
  bestSchedule,
  businessDaysApart,
  COMMON_SCHEDULES,
  nextSemimonthlyPayday,
  PAYDAY_SLACK,
  semimonthlyFit,
  STANDARD_SCHEDULE,
  type SemimonthSchedule,
} from './semimonthly.js'

/** The pay cadences a payroll uses. */
export type PayCadence = Extract<Cadence, 'week' | 'biweek' | 'semimonth' | 'month'>

/** How often a payroll pays, and for twice a month, on which days. */
export interface PayPattern {
  cadence: PayCadence
  /** The two days of the month it pays on; null unless it pays twice a month. */
  schedule: SemimonthSchedule | null
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
 * How far paydays sit off a 14-day grid, in business days added up, or null
 * when one sits more than PAYDAY_SLACK off it. The grid is anchored on
 * whichever payday fits the rest best, so a first payday moved by a holiday
 * does not throw the others off.
 */
export function biweeklyOffBy(dates: IsoDate[]): number | null {
  let best: number | null = null
  for (const anchor of dates) {
    let total = 0
    for (const date of dates) {
      const fortnights = Math.round(daysBetween(anchor, date) / FORTNIGHT)
      const off = businessDaysApart(date, addDays(anchor, fortnights * FORTNIGHT))
      if (off > PAYDAY_SLACK) {
        total = Infinity
        break
      }
      total += off
    }
    if (total !== Infinity && (best === null || total < best)) best = total
  }
  return best
}

const BIWEEKLY: PayPattern = { cadence: 'biweek', schedule: null }

/** Most business days off, in all, two paydays may be and still read as twice a month. */
const PAIR_OFF_BY = 1

/**
 * Two paydays, one gap: too few to test a grid, and any two days half a
 * month apart fit some schedule. So they read as twice a month only when
 * both land on a common schedule's days, a business day off at most.
 */
function pairPattern(dates: IsoDate[]): PayPattern {
  const fit = bestSchedule(dates, COMMON_SCHEDULES)
  const onSchedule = fit.matched === 2 && fit.bothDays && fit.offBy <= PAIR_OFF_BY
  return onSchedule ? { cadence: 'semimonth', schedule: fit.schedule } : BIWEEKLY
}

/** Biweekly or semimonthly, for paydays about two weeks apart. */
function fortnightlyPattern(dates: IsoDate[]): PayPattern {
  if (dates.length === 2) return pairPattern(dates)
  const semi = semimonthlyFit(dates)
  const grid = biweeklyOffBy(dates)
  // The closer fit wins; a tie goes to twice a month, as the header says.
  if (semi && (grid === null || semi.offBy <= grid)) {
    return { cadence: 'semimonth', schedule: semi.schedule }
  }
  return BIWEEKLY
}

/** How often paydays (oldest first, two or more) come, or null when their gaps fit no cadence. */
export function payPattern(dates: IsoDate[]): PayPattern | null {
  const rough = roughCadence(dates)
  if (rough === 'semimonth') return fortnightlyPattern(dates)
  return rough && { cadence: rough, schedule: null }
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
} {
  if (cadence !== 'semimonth') return { cadence, schedule: null }
  return { cadence, schedule: dates.length ? bestSchedule(dates).schedule : STANDARD_SCHEDULE }
}

/** The payday after `last` on this cadence, rolled forward until it is after today. */
export function nextPaydayAfter(
  last: IsoDate,
  cadence: Cadence,
  today: IsoDate,
  schedule: SemimonthSchedule = STANDARD_SCHEDULE,
): IsoDate {
  const step = (date: IsoDate) =>
    cadence === 'semimonth' ? nextSemimonthlyPayday(date, schedule) : addCadence(date, cadence)
  let next = step(last)
  while (next <= today) next = step(next)
  return next
}
