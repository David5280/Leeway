// How often a payroll pays, read from paydays, and when it pays next. Pure.
//
// The gaps between paydays say week, month, or about two weeks; about two
// weeks is every two weeks or twice a month, told apart in fortnight.ts.
// The next payday is projected from the payroll's usual day (nominal.ts).

import { daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import { fortnightlyPattern } from './fortnight.js'
import { nextScheduledPayday, nominalPayday } from './nominal.js'
import { businessDayOnOrAfter } from './businessDays.js'
import { bestSchedule, STANDARD_SCHEDULE, type SemimonthSchedule } from './semimonthly.js'

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

const within = (value: number, [least, most]: readonly [number, number]) =>
  value >= least && value <= most

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
 * payroll's usual day (nominal.ts), never from a payday a weekend or holiday
 * already moved, and then moved off a weekend the way the payroll moves
 * them: to the business day before, as most do, or after, as its paydays
 * show (a monthly payday on the 13th is a Friday the 11th when the 13th is a
 * Sunday).
 */
export function nextPaydayAfter(
  paydays: IsoDate[],
  cadence: Cadence,
  today: IsoDate,
  schedule: SemimonthSchedule = STANDARD_SCHEDULE,
): IsoDate {
  if (cadence === 'semimonth') return nextScheduledPayday(paydays, schedule, today)
  const nominal = nominalPayday(paydays, cadence)
  for (let count = 1; ; count += 1) {
    const next = nominal.roll(addCadence(nominal.date, cadence, count, nominal.dayOfMonth))
    if (next > today) return next
  }
}

/**
 * The cautious next payday for paydays that fit every two weeks and twice a
 * month alike: the later of the two, with a weekend payday on the schedule
 * moved to the business day after, so it never comes ahead of the real one
 * however the payroll moves them.
 */
export function laterNextPayday(
  paydays: IsoDate[],
  today: IsoDate,
  schedule: SemimonthSchedule,
): IsoDate {
  return maxDate(
    nextPaydayAfter(paydays, 'biweek', today),
    nextScheduledPayday(paydays, schedule, today, businessDayOnOrAfter),
  )
}
