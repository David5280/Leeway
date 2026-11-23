// Paychecks off a payroll's cycle: a bonus, a commission or a reimbursement
// the same payroll pays between paydays. Pure.
//
// They are pay, and count in what pay comes to month by month, but they say
// nothing of when pay comes. Read as paydays, a year-end bonus on Nov 20
// from a payroll paying on the 1st would make Jan 1 the next payday, and
// safe-to-spend would be spread over a month too many. So the cadence, the
// usual payday and the next one are read from the paychecks on the cycle.
//
// Timing decides, not the amount: hourly, tipped and commission pay swings
// as far as a bonus does, and a bonus can pay just what a payday does.
// - The newest paycheck fills the payday the cycle expects next after the
//   one before it (expectedPayday.ts) when it landed on or after that day,
//   or no more than EARLY_WINDOW_DAYS before it and no nearer the payday
//   before (a tie fills): a payday paid early for a holiday. Anything else
//   is set aside. What it pays plays no part.
// - Of two paychecks a short gap apart (two in one payday's slot), the one
//   farther from the cycle's grid is set aside; equally far, or with no
//   paycheck to set the grid by, the one whose amount is clearly farther
//   from the run's middle, by more than the run's own spread; else the
//   later. The newest is never set aside this way, only by its own rule,
//   as no paycheck after it shows which of the two kept the slot.
//
// Safety: when unsure, the reading that makes the next payday later wins,
// so safe to spend stays cautious (spread over more days, with more bills
// due before it), and a paycheck that may have filled the expected payday
// stays on the cycle. The one exception is a deposit clearly soon after a
// regular payday, nearer it than the next: a bonus, set aside, since read
// as a payday it would put the next payday a whole cycle late and count a
// cycle of bills too many before it.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { median } from '../../lib/money.js'
import type { Cadence } from '../../lib/periods.js'
import { expectedPaydayAfter, readingsOf } from './expectedPayday.js'
import type { Paycheck } from './paychecks.js'

/**
 * A gap shorter than this share of the usual one is not a cycle: the
 * shortest a real one gets is about 0.75 of it (twice a month, a 15th on a
 * Sunday paid on Friday the 13th after a Monday 1st).
 */
export const SHORT_GAP_SHARE = 0.6

/**
 * The most days before the expected payday a newest paycheck may land and
 * still be that payday paid early. Payrolls pay early for a holiday or a
 * year-end close: a day or two for a weekly or biweekly one, and up to
 * Wednesday Dec 23 for a Thursday Dec 31 (eight days) for a twice-monthly
 * or monthly one, a weekend more for monthly. Being no nearer the payday
 * before caps each at about half a cycle anyway.
 */
export const EARLY_WINDOW_DAYS: Record<Cadence, number> = {
  week: 3,
  biweek: 5,
  semimonth: 9,
  month: 10,
  quarter: 10,
  year: 10,
}

/** The paychecks on a payroll's cycle, and the ones set aside off it, each oldest first. */
export interface CycleSplit {
  cycle: Paycheck[]
  offCycle: Paycheck[]
}

/** What one run usually looks like: its middle gap, its middle paycheck and how far amounts stray from it. */
interface Usual {
  gapDays: number
  cents: number
  /** The median absolute deviation of its amounts: how much its pay swings. */
  spreadCents: number
}

/** The usual gap between paychecks: the middle one, the longer of two middles, as roughCadence reads it. */
function usualGap(paychecks: Paycheck[]): number {
  const gaps = paychecks
    .slice(1)
    .map((paycheck, i) => daysBetween(paychecks[i]!.date, paycheck.date))
  return [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
}

function usualOf(paychecks: Paycheck[]): Usual {
  const amounts = paychecks.map((paycheck) => paycheck.amountCents)
  const cents = median(amounts)
  const spreadCents = median(amounts.map((amount) => Math.abs(amount - cents)))
  return { gapDays: usualGap(paychecks), cents, spreadCents }
}

/** Days a paycheck sits from the nearest payday on a grid a usual gap apart through `anchor`. */
function daysOffGrid(anchor: Paycheck, paycheck: Paycheck, usual: Usual): number {
  const rest = Math.abs(daysBetween(anchor.date, paycheck.date)) % usual.gapDays
  return Math.min(rest, usual.gapDays - rest)
}

/**
 * Of two paychecks a short gap apart, the one off the cycle. `anchor` sets
 * the grid: the paycheck on the cycle before the pair, else the one after
 * it, so a bonus first in a run is judged by timing too.
 */
function offOfPair(
  earlier: Paycheck,
  later: Paycheck,
  anchor: Paycheck | undefined,
  usual: Usual,
): Paycheck {
  if (anchor) {
    const earlierOff = daysOffGrid(anchor, earlier, usual)
    const laterOff = daysOffGrid(anchor, later, usual)
    if (earlierOff !== laterOff) return earlierOff > laterOff ? earlier : later
  }
  // Amounts break the tie only when one strays from the middle by more than the run's pay swings.
  const earlierStray = Math.abs(earlier.amountCents - usual.cents)
  const laterStray = Math.abs(later.amountCents - usual.cents)
  if (Math.abs(earlierStray - laterStray) > usual.spreadCents) {
    return earlierStray > laterStray ? earlier : later
  }
  return later
}

/**
 * Whether a paycheck landing on `date` fills the payday `expected` after
 * the one on `previous`: on or after it (a late payday is never a bonus),
 * or no more than `window` days early and no nearer `previous`, a tie filling.
 */
function fills(date: IsoDate, previous: IsoDate, expected: IsoDate, window: number): boolean {
  if (date >= expected) return true
  const early = daysBetween(date, expected)
  return early <= window && early <= daysBetween(previous, date)
}

/**
 * Whether the newest paycheck on the cycle filled the payday the ones
 * before it expect next. Read both ways while the paydays fit two
 * cadences, filling either is enough: the later next payday. True when too
 * few paychecks come before it to read a cadence from.
 */
function fillsExpectedPayday(cycle: Paycheck[], given: Cadence | null): boolean {
  if (cycle.length < 3) return true
  const newest = cycle.at(-1)!.date
  const before = cycle.slice(0, -1).map((paycheck) => paycheck.date)
  const readings = readingsOf(before, given)
  if (readings.length === 0) return true
  return readings.some((reading) =>
    fills(
      newest,
      before.at(-1)!,
      expectedPaydayAfter(before, reading),
      EARLY_WINDOW_DAYS[reading.cadence],
    ),
  )
}

/**
 * Splits one run's paychecks (oldest first) into those on its cycle and
 * those off it. `given` is a cadence the owner gave, for the expected payday.
 */
export function splitCycle(paychecks: Paycheck[], given: Cadence | null = null): CycleSplit {
  if (paychecks.length < 3) return { cycle: paychecks, offCycle: [] }
  const usual = usualOf(paychecks)
  const newest = paychecks.at(-1)!
  const cycle = [paychecks[0]!]
  const offCycle: Paycheck[] = []
  paychecks.slice(1).forEach((paycheck, i) => {
    const last = cycle.at(-1)!
    if (daysBetween(last.date, paycheck.date) >= SHORT_GAP_SHARE * usual.gapDays) {
      cycle.push(paycheck)
      return
    }
    // paychecks[i + 2] is the one after this pair.
    const aside = offOfPair(last, paycheck, cycle.at(-2) ?? paychecks[i + 2], usual)
    if (aside === last) {
      // The earlier of the pair leaves the cycle, and this one takes its place.
      cycle.pop()
      offCycle.push(last)
      cycle.push(paycheck)
    } else if (paycheck === newest) {
      // Nothing after the newest shows which of the two kept the slot: its own rule decides.
      cycle.push(paycheck)
    } else {
      offCycle.push(paycheck)
    }
  })
  if (cycle.at(-1) === newest && !fillsExpectedPayday(cycle, given)) {
    offCycle.push(cycle.pop()!)
  }
  offCycle.sort((a, b) => a.date.localeCompare(b.date))
  return { cycle, offCycle }
}
