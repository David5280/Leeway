// A bill that cost more or less than usual: its latest cycle's charges,
// added up (billCycles.ts), compared with the amount the bill expects. Pure:
// the bills and their last few charges come in, changes come out;
// billChangeSource.ts reads and writes them.
//
// A bill whose amount moves by nature, like power or water, is never news.
// Its own charges say so: a steady bill's amount sits still between price
// changes, while a utility's keeps moving from cycle to cycle. So a bill whose
// earlier cycles moved in most steps raises no alert, however it was added
// (one tap, the form or an assistant); see amountsVary. Its usual amount
// still follows its recent cycles (varyingUsualCents), so the cash flow and
// idle cash hold back what it costs now rather than what it cost when tracked.
// Each cycle is read paid once there, so a bill paid twice by mistake is
// never taken to cost double.
//
// An amount the owner sets stands: nothing is settled from a cycle with a
// charge on or before the day they set it (postedSinceOwnerSet), so following
// resumes only with a cycle that came after.
//
// A change is an account alert of its own kind (bill_change), so it shows,
// notifies, hides and dismisses as the other alerts do. Dismissing or hiding
// it takes the new amount as the bill's usual one, and so does a second
// charge in a row at the new amount: either way the alert clears, and the
// same charge is never news twice.

import type { IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import type { AccountAlert, AlertFormat } from './accountAlerts.js'
import {
  CYCLE_DAYS,
  cycleCharges,
  cyclesOf,
  missedBetween,
  paidOnceCycle,
  type BillCharge,
} from './billCycles.js'

/**
 * How far a charge must be from the usual amount to be news: at least this
 * share of it and at least this many cents, so a $1 change on a $5 plan or a
 * few cents of tax on a big bill stay quiet.
 */
export const BILL_CHANGE_THRESHOLD = { share: 0.1, cents: 300 } as const

/** Whether `amountCents` is far enough from `usualCents` to be a change. */
export function isAmountChange(usualCents: number, amountCents: number): boolean {
  const gap = Math.abs(amountCents - usualCents)
  return gap >= BILL_CHANGE_THRESHOLD.cents && gap >= usualCents * BILL_CHANGE_THRESHOLD.share
}

/** Charges read per bill: about a year of monthly cycles, fewer when cycles are paid in parts. */
export const CHARGES_READ = 12

/** Moves needed before a bill's own history can say its amount varies, so three cycles at least. */
export const VARIES_AFTER_MOVES = 2

/** Recent cycles a varying bill's usual amount is read from (varyingUsualCents). */
export const VARYING_CYCLES_READ = 3

/** A bill as watching its amount needs it. */
export interface WatchedBill {
  id: string
  name: string
  /** The usual amount the bill expects. */
  amountCents: number
  cadence: Cadence
  /** The day it was tracked, in the owner's time zone. */
  trackedOn: IsoDate
  /**
   * Whether the recurring finder saw its amount move from cycle to cycle when
   * the bill was tracked. Its own charges can say so too (see amountsVary).
   */
  amountVaries: boolean
  /**
   * The day the owner last set its amount (update_bill), in their time zone,
   * or null when they never have since tracking it. Settling waits for a cycle
   * that posted after it, so the owner's figure stands until then.
   */
  amountSetOn: IsoDate | null
  /** Its last few posted charges (CHARGES_READ), newest first. */
  charges: BillCharge[]
}

export type BillChange =
  /**
   * The latest cycle is news: well off the usual amount. `charge` is its
   * latest, with the cycle's total; `cycle` the charges added up, newest first.
   */
  | { kind: 'changed'; bill: WatchedBill; charge: BillCharge; cycle: BillCharge[] }
  /**
   * The bill's usual amount is `amountCents` now: a steady bill charged it two
   * cycles in a row, or a varying bill's recent cycles say it costs that.
   */
  | { kind: 'settled'; bill: WatchedBill; amountCents: number }

/** A cycle that is news (BillChange's 'changed'). */
export type ChangedBill = Extract<BillChange, { kind: 'changed' }>

/**
 * How near two cycles must be to sit at one level: a steady bill repeats to
 * the cent, or within a few cents of tax, while a utility's jitter is wider.
 */
const SAME_LEVEL = { share: 0.01, cents: 100 } as const

/** Whether two cycle totals sit at one level (SAME_LEVEL). */
function sameLevel(aCents: number, bCents: number): boolean {
  return Math.abs(aCents - bCents) <= Math.max(SAME_LEVEL.cents, bCents * SAME_LEVEL.share)
}

/**
 * Where the first one-off sits in `amounts` (newest first), or -1: an amount
 * off from its neighbours while they sit at one level, as a credit, a late
 * fee or a double payment on a steady bill is.
 */
function oneOffAt(amounts: number[]): number {
  return amounts.findIndex((amount, i) => {
    const newer = amounts[i - 1]
    const older = amounts[i + 1]
    if (newer === undefined || older === undefined) return false
    return isAmountChange(newer, amount) && sameLevel(older, newer)
  })
}

/**
 * `amounts` (newest first) with the first one-off taken out (oneOffAt), so a
 * credit, a late fee or an extra charge between two steady ones is not read
 * as the price. The newest amount is never a one-off: nothing came after it.
 */
export function withoutOneOff(amounts: number[]): number[] {
  const oneOff = oneOffAt(amounts)
  return amounts.filter((_, i) => i !== oneOff)
}

/**
 * Whether a bill's amount varies by nature, judged by its cycles before the
 * latest (their totals, newest first), so the latest's own change cannot hide
 * itself. It does when it moved past the threshold from one cycle to the next
 * at least VARIES_AFTER_MOVES times, and in most of those steps:
 * - a price change is one move among steady cycles, and price steps (a promo
 *   ending in stages) have steady stretches between them, so neither is most;
 * - the first odd cycle that went straight back is left out, so a one-off
 *   credit, late fee or double payment is no move at all. Only the first: a
 *   bill that swings between two amounts every cycle does vary.
 */
export function amountsVary(earlier: number[]): boolean {
  const kept = withoutOneOff(earlier)
  const steps = kept.slice(1).map((older, i) => isAmountChange(older, kept[i]!))
  const moves = steps.filter(Boolean).length
  return moves >= VARIES_AFTER_MOVES && moves * 2 > steps.length
}

/**
 * What a varying bill costs now: the higher of its latest cycle's total and
 * the average of that and the cycles just before it. The latest follows a
 * bill climbing into winter at once, while the average keeps one cheap month
 * from dropping it too far. Either way the cash flow and idle cash hold back
 * no less than the bill is likely to take.
 */
export function varyingUsualCents(latestCents: number, beforeCents: number[]): number {
  const recent = [latestCents, ...beforeCents]
  const average = Math.round(recent.reduce((sum, cents) => sum + cents, 0) / recent.length)
  return Math.max(latestCents, average)
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

/**
 * A varying bill never alerts; its usual amount follows its recent cycles
 * instead, each read paid once: autopay and a manual payment in one cycle are
 * a mistake "Charged twice?" tells, not what the bill costs. Only here: the
 * steady path keeps raw totals, so a doubled cycle shows as changed and
 * doublePaidBills.ts can tell it once.
 */
function followVaryingBill(
  bill: WatchedBill,
  latest: BillCharge,
  earlier: BillCharge[],
  cycle: number,
): BillChange | null {
  const paidOnce = (first: BillCharge) => paidOnceCycle(bill.charges, first, cycle).amountCents
  const before = cyclesJustBefore(latest, earlier, cycle).map(paidOnce)
  const usualCents = varyingUsualCents(paidOnce(latest), before)
  // Already there: nothing to write, so refreshing again settles nothing.
  if (usualCents === bill.amountCents) return null
  return { kind: 'settled', bill, amountCents: usualCents }
}

/**
 * A steady bill's latest cycle against its usual amount and the cycle before:
 * settled when both sit at the new amount, changed when only the latest does.
 */
function steadyBillChange(
  bill: WatchedBill,
  latest: BillCharge,
  previous: BillCharge | undefined,
  cycle: number,
): BillChange | null {
  if (!previous || !isAmountChange(bill.amountCents, latest.amountCents)) return null
  if (missedBetween(previous.date, latest.date, cycle)) return null
  if (!isAmountChange(previous.amountCents, latest.amountCents)) {
    return { kind: 'settled', bill, amountCents: latest.amountCents }
  }
  // The first charge since tracking: the usual amount was only an estimate from history.
  if (previous.date <= bill.trackedOn) return null
  return { kind: 'changed', bill, charge: latest, cycle: cycleCharges(bill.charges, latest, cycle) }
}

/**
 * Whether every charge in the cycle from `latest` posted after the day the
 * owner last set the bill's amount. A charge on that very day may have come
 * before the edit, so it does not count: the owner's figure stands.
 */
function postedSinceOwnerSet(bill: WatchedBill, latest: BillCharge, cycle: number): boolean {
  const setOn = bill.amountSetOn
  if (setOn === null) return true
  return cycleCharges(bill.charges, latest, cycle).every((charge) => charge.date > setOn)
}

/**
 * What a bill's latest cycle says about its amount, or null when nothing:
 * no charge since the bill was tracked or within the last cycle and a half,
 * or, for a steady bill, a total near the usual amount, a missed cycle or no
 * cycle before it, or a change on the first charge since tracking, when the
 * usual amount was only an estimate from history. A bill whose amount varies
 * (flagged when tracked, or by its own history) is never changed, only
 * settled at what its recent cycles say it costs now. Nothing is settled
 * from a cycle that began on or before the owner last set the amount.
 */
export function billChangeOf(bill: WatchedBill, today: IsoDate): BillChange | null {
  const cycle = CYCLE_DAYS[bill.cadence]
  const [latest, ...earlier] = cyclesOf(bill.charges, cycle)
  if (!latest || latest.date <= bill.trackedOn) return null
  if (missedBetween(latest.date, today, cycle)) return null
  // Judged by the cycles before the latest, so the latest's own change cannot hide itself.
  const varies = bill.amountVaries || amountsVary(earlier.map((one) => one.amountCents))
  const change = varies
    ? followVaryingBill(bill, latest, earlier, cycle)
    : steadyBillChange(bill, latest, earlier[0], cycle)
  // An amount the owner set is never overwritten by a cycle from before they set it.
  if (change?.kind === 'settled' && !postedSinceOwnerSet(bill, latest, cycle)) return null
  return change
}

/**
 * The alert for a changed charge, naming the bill and the amounts only: no
 * account, so no account's name or number reaches the inbox, an email or an
 * assistant through its words. A higher charge is a warning; a lower one is
 * only worth knowing.
 */
export function billChangeAlert(
  { bill, charge }: Pick<ChangedBill, 'kind' | 'bill' | 'charge'>,
  accountName: string,
  { money }: Pick<AlertFormat, 'money'>,
): AccountAlert {
  const sentence = `${bill.name} was ${money(charge.amountCents)}, usually ${money(bill.amountCents)}.`
  return {
    kind: 'bill_change',
    severity: charge.amountCents > bill.amountCents ? 'warning' : 'info',
    accountId: charge.accountId,
    accountName,
    amountCents: charge.amountCents,
    count: 1,
    date: charge.date,
    message: sentence,
    summary: sentence,
    bill: { id: bill.id, name: bill.name, usualCents: bill.amountCents },
  }
}
