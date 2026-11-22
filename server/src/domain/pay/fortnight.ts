// Every two weeks or twice a month, for paydays about two weeks apart. Pure.
//
// Both pay every 14 to 16 days, so gap length alone cannot tell them apart.
// Two explanations are weighed instead, each in business days off:
// - a 14-day grid, as a biweekly payroll keeps: every payday a whole number
//   of fortnights from the others, within a business day for a holiday,
//   with one payday well off it (posted days late, or paid days early for
//   a long closure) let off in a run of four or more;
// - a schedule, two days of the month as a semimonthly payroll keeps
//   (semimonthly.ts), that takes every payday.
// Neither is settled before CONFIRM_FROM paydays, by when a semimonthly
// payroll has drifted off any grid and a biweekly one off every schedule.
// Twice a month is read once no grid comes near and a schedule fits
// closely, or once a schedule fits clearly closer than the grid: a common
// one by SETTLE_MARGIN, any other by CONFIRM_MARGIN, since one of the many
// fits almost any few paydays. Every two weeks is read once the grid fits
// CONFIRM_MARGIN closer than any schedule of any two days. Until then the
// paydays fit both: they read as every two weeks, marked ambiguous, and
// what is built on them takes the cautious side of each (pay/current.ts).

import { toDayNumber, type IsoDate } from '../../lib/dates.js'
import type { PayPattern } from './cadence.js'
import { weekdaysApart } from './businessDays.js'
import {
  bestSchedule,
  COMMON_SCHEDULES,
  semimonthlyFit,
  type ScheduleFit,
  type SemimonthSchedule,
} from './semimonthly.js'

const FORTNIGHT = 14

/**
 * How far a biweekly payroll moves a payday off its grid: a business day,
 * to the day before a holiday. It keeps its weekday otherwise, so paydays
 * that do not are ones a 14-day grid cannot explain, but for one stray.
 */
export const GRID_SLACK = 1

/**
 * Paydays it takes to settle either reading, and runs this long or longer
 * may hold one stray payday and keep their grid: by the fourth,
 * a semimonthly payroll has drifted off any 14-day grid and a biweekly one
 * off every schedule. With one fewer, two readings could take turns.
 */
export const CONFIRM_FROM = 4

/**
 * How much closer, in business days, one reading must fit than the other to
 * settle on it: a holiday and a weekend can each put a payday a business day
 * or two off, so anything closer fits both.
 */
const CONFIRM_MARGIN = 3

/** How much closer a common schedule must fit than the grid to settle on twice a month. */
const SETTLE_MARGIN = 2

/**
 * Most business days off a schedule, per payday on it on average, that still
 * reads as twice a month when no grid comes near: a semimonthly payroll is
 * off only for a holiday or a late posting, where paydays two weeks apart
 * drift up to three business days off any.
 */
const SCHEDULE_OFF_PER_PAYDAY = 1

const BIWEEKLY: PayPattern = { cadence: 'biweek', schedule: null, ambiguous: false }

/**
 * How far paydays sit off the 14-day grid that fits them best, in business
 * days added up, for some anchor among them: none more than GRID_SLACK off,
 * but for one stray in a run of CONFIRM_FROM or more, which counts as
 * GRID_SLACK, since a late bank or a long closure moved it, not the payroll.
 * Null when no grid does. Business days alone would let a grid anchored on
 * a Monday take every Friday as a day off it, so each payday off adds up.
 */
export function gridOffBy(dates: IsoDate[]): number | null {
  const days = dates.map(toDayNumber)
  const straysAllowed = dates.length >= CONFIRM_FROM ? 1 : 0
  let best: number | null = null
  for (const anchor of days) {
    let strays = 0
    let total = 0
    for (const day of days) {
      const onGrid = anchor + Math.round((day - anchor) / FORTNIGHT) * FORTNIGHT
      const off = weekdaysApart(day, onGrid)
      if (off > GRID_SLACK) strays += 1
      total += Math.min(off, GRID_SLACK)
    }
    if (strays <= straysAllowed && (best === null || total < best)) best = total
  }
  return best
}

/** The closest schedule, of `candidates` (any two days by default), that takes every payday. */
function scheduleTakingEvery(
  dates: IsoDate[],
  candidates?: readonly SemimonthSchedule[],
): ScheduleFit | null {
  const fit = bestSchedule(dates, candidates)
  return fit.matched === dates.length && fit.bothDays ? fit : null
}

/**
 * Both readings, with the closest schedule as the twice-a-month one: on a
 * tie the later, whose next payday comes no earlier (semimonthly.ts).
 */
const eitherPattern = (dates: IsoDate[]): PayPattern => ({
  cadence: 'biweek',
  schedule: bestSchedule(dates).schedule,
  ambiguous: true,
})

/**
 * The schedule to settle on, given the closest and how far off the grid the
 * paydays lie (no grid near them by default), once there are CONFIRM_FROM
 * paydays: a common one that fits every payday the closest does as closely,
 * as the more likely, once it fits SETTLE_MARGIN closer than the grid; else
 * the closest, once it fits CONFIRM_MARGIN closer. Null before.
 */
function settledSchedule(
  dates: IsoDate[],
  closest: ScheduleFit,
  offGrid = Infinity,
): ScheduleFit | null {
  if (dates.length < CONFIRM_FROM) return null
  const common = bestSchedule(dates, COMMON_SCHEDULES)
  const likely = common.matched >= closest.matched && common.bothDays
  if (likely && common.offBy <= closest.offBy) {
    return offGrid - common.offBy >= SETTLE_MARGIN ? common : null
  }
  return offGrid - closest.offBy >= CONFIRM_MARGIN ? closest : null
}

const semimonthly = (fit: ScheduleFit): PayPattern => ({
  cadence: 'semimonth',
  schedule: fit.schedule,
  ambiguous: false,
})

/**
 * Paydays a grid explains, `offGrid` business days off it: twice a month
 * once there is a schedule to settle on; every two weeks once there are
 * CONFIRM_FROM paydays and every schedule fits CONFIRM_MARGIN further off;
 * both otherwise.
 */
function onGridPattern(dates: IsoDate[], offGrid: number): PayPattern {
  const closest = scheduleTakingEvery(dates)
  const settled = closest && settledSchedule(dates, closest, offGrid)
  if (settled) return semimonthly(settled)
  const confirmed = !closest || closest.offBy - offGrid >= CONFIRM_MARGIN
  if (dates.length >= CONFIRM_FROM && confirmed) return BIWEEKLY
  return eitherPattern(dates)
}

/**
 * Paydays no grid comes near: twice a month when there is a schedule to
 * settle on that fits them closely. Paydays that fit neither are read as
 * both, the cautious way.
 */
function offGridPattern(dates: IsoDate[]): PayPattern {
  const fit = semimonthlyFit(dates)
  const close = fit !== null && fit.offBy <= fit.matched * SCHEDULE_OFF_PER_PAYDAY
  const settled = close && settledSchedule(dates, fit)
  return settled ? semimonthly(settled) : eitherPattern(dates)
}

/** How paydays read on their own, before any earlier settling is kept. */
function readingOf(dates: IsoDate[]): PayPattern {
  const offGrid = gridOffBy(dates)
  return offGrid === null ? offGridPattern(dates) : onGridPattern(dates, offGrid)
}

/** Whether every payday still keeps a settled reading: its schedule takes each, or a grid does. */
function stillKeeps(pattern: PayPattern, dates: IsoDate[]): boolean {
  if (pattern.cadence === 'biweek') return gridOffBy(dates) !== null
  return scheduleTakingEvery(dates, [pattern.schedule!]) !== null
}

/**
 * Biweekly or semimonthly, for paydays (oldest first, two or more) about
 * two weeks apart. A reading the paydays once settled on stays while every
 * payday since keeps to it: a holiday that puts one twice-a-month payday a
 * day nearer the grid does not unsettle it.
 */
export function fortnightlyPattern(dates: IsoDate[]): PayPattern {
  const reading = readingOf(dates)
  if (!reading.ambiguous) return reading
  for (let count = dates.length - 1; count >= CONFIRM_FROM; count -= 1) {
    const earlier = readingOf(dates.slice(0, count))
    if (!earlier.ambiguous) return stillKeeps(earlier, dates) ? earlier : reading
  }
  return reading
}
