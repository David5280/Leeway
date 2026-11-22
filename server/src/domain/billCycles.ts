// A bill's posted charges read as cycles: each cycle's charges found and
// added up as one, a charge made twice counted once, and a gap between two
// charges told from a missed cycle. Pure; billChanges.ts and the leak checks
// read a bill's charges through it.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import { DUPLICATE_DAYS } from './leaks/duplicates.js'

/** A posted charge that paid a bill. */
export interface BillCharge {
  accountId: string
  date: IsoDate
  /** Positive: what the charge cost. */
  amountCents: number
}

/** About how many days apart each cadence's charges come. */
export const CYCLE_DAYS: Record<Cadence, number> = {
  week: 7,
  biweek: 14,
  semimonth: 15,
  month: 31,
  quarter: 92,
  year: 366,
}

/** A gap past this many cycles between charges means one was missed. */
const MISSED_CYCLES = 1.5

/** Whether more than a cycle and a half (MISSED_CYCLES) passed from `older` to `newer`. */
export function missedBetween(older: IsoDate, newer: IsoDate, cycle: number): boolean {
  return daysBetween(older, newer) > cycle * MISSED_CYCLES
}

/**
 * A cycle's charges (newest first) less the repeats: of the charges of one
 * amount on one account within DUPLICATE_DAYS of each other, only the oldest,
 * as duplicates.ts reads a charge made twice.
 */
export function withoutRepeats(cycle: BillCharge[]): BillCharge[] {
  const kept: BillCharge[] = []
  // Oldest first, so the first of each run is the one kept.
  for (const charge of [...cycle].reverse()) {
    const repeats = kept.some(
      (one) =>
        one.accountId === charge.accountId &&
        one.amountCents === charge.amountCents &&
        daysBetween(one.date, charge.date) <= DUPLICATE_DAYS,
    )
    if (!repeats) kept.push(charge)
  }
  return kept.reverse()
}

/**
 * Whether one cycle's charges hold two of one amount, however far apart and
 * on whichever accounts. That may be a charge made twice (autopay from
 * checking, a manual payment by card a few days later) or an even split.
 * withoutRepeats cannot tell: it reads only a repeat on one account within
 * DUPLICATE_DAYS as a charge made twice.
 */
export function holdsEqualPair(cycle: BillCharge[]): boolean {
  const amounts = cycle.map((charge) => charge.amountCents)
  return new Set(amounts).size < amounts.length
}

/** What a cycle cost paid once: its charges added up, the repeats left out (withoutRepeats). */
export function paidOnceCents(cycle: BillCharge[]): number {
  return withoutRepeats(cycle).reduce((sum, charge) => sum + charge.amountCents, 0)
}

/**
 * One cycle's charges from `first` (newest first) on: those within half a
 * cycle before it, as a split or second payment is.
 */
export function cycleCharges(
  charges: BillCharge[],
  first: BillCharge,
  cycle: number,
): BillCharge[] {
  return charges.filter(
    (charge) => charge.date <= first.date && daysBetween(charge.date, first.date) < cycle / 2,
  )
}

/** One cycle's charges from `first` on (cycleCharges), added up as one. */
function cycleFrom(charges: BillCharge[], first: BillCharge, cycle: number): BillCharge {
  const within = cycleCharges(charges, first, cycle)
  return { ...first, amountCents: within.reduce((sum, charge) => sum + charge.amountCents, 0) }
}

/**
 * Every cycle in `charges` (newest first), each added up as one charge,
 * newest first. A charge made twice counts twice here, so a doubled cycle
 * shows as a change (leaks/doublePaidBills.ts); varyingBills.ts reads each
 * cycle paid once.
 */
export function cyclesOf(charges: BillCharge[], cycle: number): BillCharge[] {
  const cycles: BillCharge[] = []
  let rest = charges
  while (rest[0]) {
    const first = rest[0]
    cycles.push(cycleFrom(rest, first, cycle))
    // The next cycle starts at the first charge at least half a cycle older.
    rest = rest.filter((charge) => daysBetween(charge.date, first.date) >= cycle / 2)
  }
  return cycles
}
