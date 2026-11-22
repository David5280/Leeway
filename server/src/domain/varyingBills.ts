// A varying bill's usual amount (power, water) following its recent cycles,
// so the cash flow and idle cash hold back what it costs now rather than
// what it cost when tracked. Pure; billChanges.ts asks here once a bill's
// history says its amount varies.
//
// A charge made twice never lifts the amount. Repeats on one account within
// a few days are read once (withoutRepeats). Any other two equal charges in a
// cycle, on two accounts or further apart, may be a mistake or an even split,
// which no rule can tell apart. So a cycle holding them that costs nearer
// double than the usual level (DOUBLED_SHARE) is not read at all: the amount
// stays as it was rather than settle at double. A bill paid in even halves
// that climbs a little each cycle still follows.

import type { BillChange, WatchedBill } from './billChanges.js'
import {
  cycleCharges,
  holdsEqualPair,
  missedBetween,
  withoutRepeats,
  type BillCharge,
} from './billCycles.js'

/** Recent cycles a varying bill's usual amount is read from (varyingUsualCents). */
const VARYING_CYCLES_READ = 3

/**
 * How many times the usual level a cycle holding two equal charges must cost
 * to be doubtful: halfway between paid once (1) and paid twice (2), so it is
 * nearer double than the usual level.
 */
const DOUBLED_SHARE = 1.5

/**
 * What a varying bill costs now: the higher of its latest cycle's total and
 * the average of that and the cycles just before it. The latest follows a
 * bill climbing into winter at once, while the average keeps one cheap month
 * from dropping it too far. Either way the cash flow and idle cash hold back
 * no less than the bill is likely to take.
 */
export function varyingUsualCents(latestCents: number, beforeCents: number[]): number {
  const recent = [latestCents, ...beforeCents]
  return Math.max(latestCents, averageOf(recent))
}

function averageOf(cents: number[]): number {
  return Math.round(cents.reduce((sum, one) => sum + one, 0) / cents.length)
}

/**
 * The cycles just before `latest` that varyingUsualCents reads, newest first:
 * up to VARYING_CYCLES_READ with the latest, stopping at a missed cycle, so a
 * bill paused over summer is read from this season only.
 */
function cyclesJustBefore(latest: BillCharge, earlier: BillCharge[], cycle: number): BillCharge[] {
  const before: BillCharge[] = []
  let newer = latest
  for (const older of earlier.slice(0, VARYING_CYCLES_READ - 1)) {
    if (missedBetween(older.date, newer.date, cycle)) break
    before.push(older)
    newer = older
  }
  return before
}

/** A cycle as following reads it: paid once, and whether it may hold a charge made twice. */
interface ReadCycle {
  cents: number
  maybePaidTwice: boolean
}

/** The cycle from `first` read paid once, its repeats on one account left out. */
function readCycle(charges: BillCharge[], first: BillCharge, cycle: number): ReadCycle {
  const paidOnce = withoutRepeats(cycleCharges(charges, first, cycle))
  return {
    cents: paidOnce.reduce((sum, charge) => sum + charge.amountCents, 0),
    maybePaidTwice: holdsEqualPair(paidOnce),
  }
}

/** Whether a cycle that may hold a charge made twice costs nearer double `otherCents` than it. */
function doubtfulAbove(read: ReadCycle, otherCents: number): boolean {
  return read.maybePaidTwice && read.cents > otherCents * DOUBLED_SHARE
}

/**
 * A varying bill never alerts; its usual amount follows its recent cycles
 * instead, each read paid once. Only here: the steady path keeps raw totals,
 * so a doubled cycle shows as changed and doublePaidBills.ts can tell it
 * once. An earlier cycle that may be doubled and costs nearer double the
 * latest is left out of the average; a latest one that costs nearer double
 * the cycles before it settles nothing.
 */
export function followVaryingBill(
  bill: WatchedBill,
  latest: BillCharge,
  earlier: BillCharge[],
  cycle: number,
): BillChange | null {
  const now = readCycle(bill.charges, latest, cycle)
  const before = cyclesJustBefore(latest, earlier, cycle)
    .map((first) => readCycle(bill.charges, first, cycle))
    .filter((read) => !doubtfulAbove(read, now.cents))
    .map((read) => read.cents)
  // With no cycle before it to compare with, the usual amount is the measure.
  const othersCents = before.length > 0 ? averageOf(before) : bill.amountCents
  if (doubtfulAbove(now, othersCents)) return null
  const usualCents = varyingUsualCents(now.cents, before)
  // Already there: nothing to write, so refreshing again settles nothing.
  if (usualCents === bill.amountCents) return null
  return { kind: 'settled', bill, amountCents: usualCents }
}
