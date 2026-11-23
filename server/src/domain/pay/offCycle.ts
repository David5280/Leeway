// Paychecks off a payroll's cycle: a bonus, a commission or a reimbursement
// the same payroll pays between paydays. Pure.
//
// They are pay, and count in what pay comes to month by month, but they say
// nothing of when pay comes. Read as paydays, a year-end bonus on Nov 20
// from a payroll paying on the 1st would make Jan 1 the next payday, and
// safe-to-spend would be spread over a month too many. So the cadence, the
// usual payday and the next one are read from the paychecks on the cycle.
//
// Timing alone cannot tell a bonus from a payday that moved: a payroll pays
// early before a holiday and posts late after a bank delay. Amount can, as a
// bonus rarely pays what a payday does and a moved payday always does. So a
// paycheck is set aside only when its amount is unlike the run's usual one
// (LIKE_PAY_SHARE) and its timing is off the cycle:
// - it is one of two paychecks a short gap apart: of the pair, the one
//   unlike the usual amount, or with both unlike it, the one farther from
//   the cycle's grid;
// - it is the newest and lands days before the payday the cycle projects.
//   A late one never is.

import { daysBetween, minDate, type IsoDate } from '../../lib/dates.js'
import { median } from '../../lib/money.js'
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

/**
 * Days before the projected payday the newest paycheck must land to be off
 * the cycle: weekends and holidays are already in the projection, so more
 * than this is no move of a payday.
 */
export const EARLY_DAYS = 4

/**
 * How far a paycheck may stray from the run's middle amount, as a share of
 * it, and still pay like a payday. Wide enough for overtime and a raise,
 * narrow enough that a bonus or commission rarely falls inside.
 */
export const LIKE_PAY_SHARE = 0.25

/** The paychecks on a payroll's cycle, and the ones set aside off it, each oldest first. */
export interface CycleSplit {
  cycle: Paycheck[]
  offCycle: Paycheck[]
}

/** What one run usually looks like: its middle gap in days and its middle paycheck. */
interface Usual {
  gapDays: number
  cents: number
}

/** The usual gap between paychecks: the middle one, the longer of two middles, as roughCadence reads it. */
function usualGap(paychecks: Paycheck[]): number {
  const gaps = paychecks
    .slice(1)
    .map((paycheck, i) => daysBetween(paychecks[i]!.date, paycheck.date))
  return [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
}

/** True when the paycheck pays about what the run's usual paycheck does. */
function paysLikeUsual(paycheck: Paycheck, usual: Usual): boolean {
  return Math.abs(paycheck.amountCents - usual.cents) <= LIKE_PAY_SHARE * usual.cents
}

/** Days a paycheck sits from the nearest payday on a grid a usual gap apart, counted from `anchor`. */
function daysOffGrid(anchor: Paycheck, paycheck: Paycheck, usual: Usual): number {
  const rest = daysBetween(anchor.date, paycheck.date) % usual.gapDays
  return Math.min(rest, usual.gapDays - rest)
}

/**
 * Of two paychecks a short gap apart, the one off the cycle, or null when
 * both pay like a payday (one of them moved early or late). `anchor` is the
 * paycheck on the cycle before the pair, if any, to set the grid by.
 */
function offOfPair(
  earlier: Paycheck,
  later: Paycheck,
  anchor: Paycheck | undefined,
  usual: Usual,
): Paycheck | null {
  const earlierLike = paysLikeUsual(earlier, usual)
  const laterLike = paysLikeUsual(later, usual)
  if (earlierLike && laterLike) return null
  if (earlierLike !== laterLike) return earlierLike ? later : earlier
  // Both unlike a payday: the one farther from the grid, the later on a tie or with no grid.
  if (!anchor) return later
  return daysOffGrid(anchor, earlier, usual) > daysOffGrid(anchor, later, usual) ? earlier : later
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
  const usual: Usual = {
    gapDays: usualGap(paychecks),
    cents: median(paychecks.map((paycheck) => paycheck.amountCents)),
  }
  const cycle = [paychecks[0]!]
  const offCycle: Paycheck[] = []
  for (const paycheck of paychecks.slice(1)) {
    const last = cycle.at(-1)!
    const short = daysBetween(last.date, paycheck.date) < SHORT_GAP_SHARE * usual.gapDays
    const aside = short ? offOfPair(last, paycheck, cycle.at(-2), usual) : null
    // The earlier of the pair was the one off the cycle: it leaves, this one takes its place.
    if (aside === last) cycle.pop()
    if (aside) offCycle.push(aside)
    if (aside !== paycheck) cycle.push(paycheck)
  }
  offCycle.sort((a, b) => a.date.localeCompare(b.date))
  // A newest paycheck already set aside leaves the cycle's own newest checked by the one after it.
  if (offCycle.includes(paychecks.at(-1)!)) return { cycle, offCycle }
  return withNewestChecked({ cycle, offCycle }, usual, given)
}

/** Sets the newest paycheck aside too when it pays unlike a payday and landed days before the projected one. */
function withNewestChecked(split: CycleSplit, usual: Usual, given: Cadence | null): CycleSplit {
  const { cycle, offCycle } = split
  if (cycle.length < 3) return split
  const newest = cycle.at(-1)!
  // A payday paid early, before a holiday, pays what a payday does.
  if (paysLikeUsual(newest, usual)) return split
  const projected = projectedPayday(cycle.slice(0, -1), given)
  if (projected === null || daysBetween(newest.date, projected) <= EARLY_DAYS) return split
  const sorted = [...offCycle, newest].sort((a, b) => a.date.localeCompare(b.date))
  return { cycle: cycle.slice(0, -1), offCycle: sorted }
}
