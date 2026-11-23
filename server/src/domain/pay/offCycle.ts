// Paychecks off a payroll's cycle: a bonus, a commission or a reimbursement
// the same payroll pays between paydays. Pure.
//
// They are pay, and count in what pay comes to month by month, but they say
// nothing of when pay comes. Read as paydays, a year-end bonus on Nov 20
// from a payroll paying on the 1st would make Jan 1 the next payday, and
// safe-to-spend would be spread over a month too many. So the cadence, the
// usual payday and the next one are read from the paychecks on the cycle.
//
// A paycheck is off the cycle when it comes well before a full cycle has
// passed since the last one on it:
// - mid-run, when the gap before it is short, or the gap after it is and
//   the paychecks either side are about a cycle apart without it;
// - the newest, when the gap before it is short, or it lands days before
//   the payday the paychecks on the cycle project. A late one never is.

import { daysBetween, minDate, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { nextPaydayAfter, payPattern } from './cadence.js'
import { nextScheduledPayday } from './nominal.js'
import type { Paycheck } from './paychecks.js'

/**
 * A gap shorter than this share of the usual one is not a cycle: the
 * shortest a real one gets is about 0.75 of it (twice a month, a 15th on a
 * Sunday paid on Friday the 13th after a Monday 1st).
 */
export const SHORT_GAP_SHARE = 0.6

/** Days a gap may run over the usual one and still be one cycle, so a set-aside never opens a missed one. */
const CYCLE_SLACK_DAYS = 4

/**
 * Days before the projected payday the newest paycheck must land to be off
 * the cycle: weekends and holidays are already in the projection, so more
 * than this is no move of a payday.
 */
export const EARLY_DAYS = 4

/** The paychecks on a payroll's cycle, and the ones set aside off it, each oldest first. */
export interface CycleSplit {
  cycle: Paycheck[]
  offCycle: Paycheck[]
}

/** The usual gap between paychecks: the middle one, the longer of two middles, as roughCadence reads it. */
function usualGap(paychecks: Paycheck[]): number {
  const gaps = paychecks
    .slice(1)
    .map((paycheck, i) => daysBetween(paychecks[i]!.date, paycheck.date))
  return [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
}

/** The payday the paychecks on the cycle point to next, the earlier where they fit two readings. */
function projectedPayday(cycle: Paycheck[], given: Cadence | null): IsoDate | null {
  const dates = cycle.map((paycheck) => paycheck.date)
  const last = dates.at(-1)!
  if (given) return nextPaydayAfter(dates, given, last)
  const pattern = dates.length > 1 ? payPattern(dates) : null
  if (!pattern) return null
  const next = nextPaydayAfter(dates, pattern.cadence, last, pattern.schedule ?? undefined)
  // Read as either, only a paycheck early for both is off the cycle.
  return pattern.ambiguous
    ? minDate(next, nextScheduledPayday(dates, pattern.schedule!, last))
    : next
}

/**
 * Splits one run's paychecks (oldest first) into those on its cycle and
 * those off it. `given` is a cadence the owner gave, for the projection.
 */
export function splitCycle(paychecks: Paycheck[], given: Cadence | null = null): CycleSplit {
  if (paychecks.length < 3) return { cycle: paychecks, offCycle: [] }
  const usual = usualGap(paychecks)
  const short = (gap: number) => gap < SHORT_GAP_SHARE * usual
  const cycle = [paychecks[0]!]
  const offCycle: Paycheck[] = []
  for (const [i, paycheck] of paychecks.entries()) {
    if (i === 0) continue
    const last = cycle.at(-1)!
    const next = paychecks[i + 1]
    // The next paycheck is the payday this one came ahead of: a cycle on from the last without it.
    const aheadOfNext =
      next !== undefined &&
      short(daysBetween(paycheck.date, next.date)) &&
      daysBetween(last.date, next.date) <= usual + CYCLE_SLACK_DAYS
    if (short(daysBetween(last.date, paycheck.date)) || aheadOfNext) offCycle.push(paycheck)
    else cycle.push(paycheck)
  }
  // A newest paycheck already set aside leaves the cycle's own newest checked by the one after it.
  if (offCycle.at(-1) === paychecks.at(-1)) return { cycle, offCycle }
  return withNewestChecked({ cycle, offCycle }, given)
}

/** Sets the newest paycheck aside too when it landed days before the payday the cycle projected. */
function withNewestChecked(split: CycleSplit, given: Cadence | null): CycleSplit {
  const { cycle, offCycle } = split
  if (cycle.length < 3) return split
  const newest = cycle.at(-1)!
  const projected = projectedPayday(cycle.slice(0, -1), given)
  if (projected === null || daysBetween(newest.date, projected) <= EARLY_DAYS) return split
  const sorted = [...offCycle, newest].sort((a, b) => a.date.localeCompare(b.date))
  return { cycle: cycle.slice(0, -1), offCycle: sorted }
}
