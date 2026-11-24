// Paychecks off a payroll's cycle: a bonus or a commission the same payroll
// pays between paydays. Pure. (A deposit that says it is a reimbursement is
// money back, never pay, so it never reaches here: see deposits.ts.)
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
//   farther from the cycle's grid, which steps only by gaps no bonus
//   split, is set aside; equally far, or with no grid to go by, the one whose
//   amount is clearly farther from the run's middle, by more than the run's
//   own spread; else the later. The newest is never set aside this way,
//   only by its own rule, as no paycheck after it shows which of the two
//   kept the slot.
// - "Short" is against the usual gap, which a bonus in a run of three or
//   four can lower to its own; such a run's gap is read without it where
//   timing and amount both set it apart (shortRun.ts), an estimate until a
//   fifth paycheck.
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
import { shortRunPaydays } from './shortRun.js'

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
  /** True when a short run's gap was read without one of its paychecks (shortRun.ts). */
  shortRun: boolean
}

/** What one run usually looks like: its gaps, its middle paycheck and how far amounts stray. */
interface Usual {
  /** The gap a short one is measured against. */
  gapDays: number
  /** The gap the run's grid steps by, or null when no gap is clean (see gapsOf). */
  gridDays: number | null
  cents: number
  /** The median absolute deviation of its amounts: how much its pay swings. */
  spreadCents: number
}

/** The middle value, the longer of two middles, as roughCadence reads gaps. */
const middleOf = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

/**
 * A run's usual gap and its grid's step. A paycheck between paydays splits
 * a payday's gap in two, so the grid steps only by clean gaps: neither
 * short nor beside a short one. A run of three or four with a bonus in it
 * may hold none (Oct 16, a bonus Oct 20, Oct 30), and then has no grid to
 * go by: read by its gaps alone, the bonus's own would line the grid up
 * with it.
 */
function gapsOf(paychecks: Paycheck[]): Pick<Usual, 'gapDays' | 'gridDays'> {
  const gaps = paychecks
    .slice(1)
    .map((paycheck, i) => daysBetween(paychecks[i]!.date, paycheck.date))
  const rough = middleOf(gaps)
  const short = gaps.map((gap) => gap < SHORT_GAP_SHARE * rough)
  const clean = gaps.filter((gap, i) => !short[i] && !short[i - 1] && !short[i + 1])
  const gridDays = clean.length ? middleOf(clean) : null
  return { gapDays: gridDays ?? rough, gridDays }
}

/**
 * What a run usually pays and how far apart, its gaps read from `paydays`:
 * the run itself, or a short one without its bonus (shortRun.ts).
 */
function usualOf(paychecks: Paycheck[], paydays: Paycheck[]): Usual {
  const amounts = paychecks.map((paycheck) => paycheck.amountCents)
  const cents = median(amounts)
  const spreadCents = median(amounts.map((amount) => Math.abs(amount - cents)))
  return { ...gapsOf(paydays), cents, spreadCents }
}

/** Days a paycheck sits from the nearest payday on a grid `gridDays` apart through `anchor`. */
function daysOffGrid(anchor: Paycheck, paycheck: Paycheck, gridDays: number): number {
  const rest = Math.abs(daysBetween(anchor.date, paycheck.date)) % gridDays
  return Math.min(rest, gridDays - rest)
}

/**
 * Of two paychecks a short gap apart, the one off the cycle. `anchor` sets
 * the grid: the paycheck on the cycle before the pair, else the one after
 * it, so a bonus first in a run is judged by timing too. With no anchor or
 * no grid, amounts decide.
 */
function offOfPair(
  earlier: Paycheck,
  later: Paycheck,
  anchor: Paycheck | undefined,
  usual: Usual,
): Paycheck {
  if (anchor && usual.gridDays !== null) {
    const earlierOff = daysOffGrid(anchor, earlier, usual.gridDays)
    const laterOff = daysOffGrid(anchor, later, usual.gridDays)
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
  if (paychecks.length < 3) return { cycle: paychecks, offCycle: [], shortRun: false }
  // Where a bonus would be a short run's middle gap, its gaps are read without it.
  const paydays = shortRunPaydays(paychecks, given)
  const usual = usualOf(paychecks, paydays ?? paychecks)
  const newest = paychecks.at(-1)!
  const cycle = [paychecks[0]!]
  const offCycle: Paycheck[] = []
  paychecks.slice(1).forEach((paycheck, i) => {
    const last = cycle.at(-1)!
    if (daysBetween(last.date, paycheck.date) >= SHORT_GAP_SHARE * usual.gapDays) {
      cycle.push(paycheck)
      return
    }
    const after = paychecks[i + 2]
    const aside = offOfPair(last, paycheck, cycle.at(-2) ?? after, usual)
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
  return { cycle, offCycle, shortRun: paydays !== null }
}
