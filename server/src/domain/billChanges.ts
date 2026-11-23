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
// idle cash hold back what it costs now rather than what it cost when tracked
// (varyingBills.ts).
//
// An amount the owner sets stands: no cycle with a charge on or before the day
// they set it says anything about it (postedAfter), so following resumes
// only with a cycle that came after. A steady bill charged its old price
// again after the owner set a new one is news, not a settling: their change
// did not take. The amounts bills had when following began are kept the same
// way, but from following only (followAfterOn): a steady bill's alerts never
// waited on them.
//
// A change is an account alert of its own kind (bill_change), so it shows,
// notifies, hides and dismisses as the other alerts do. Dismissing or hiding
// it takes the new amount as the bill's usual one, and so does a second
// charge in a row at the new amount: either way the alert clears, and the
// same charge is never news twice.

import type { IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import type { AccountAlert, AlertFormat } from './accountAlerts.js'
import { isAmountChange } from './billAmountChange.js'
import { CYCLE_DAYS, cycleCharges, cyclesOf, missedBetween, type BillCharge } from './billCycles.js'
import { followVaryingBill } from './varyingBills.js'

/** Charges read per bill: about a year of monthly cycles, fewer when cycles are paid in parts. */
export const CHARGES_READ = 12

/** Moves needed before a bill's own history can say its amount varies, so three cycles at least. */
export const VARIES_AFTER_MOVES = 2

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
  /**
   * The day following began, for a bill whose amount was there before then
   * and may be the owner's own (migration 035), or null. Following a varying
   * bill waits for a cycle that posted after it; a steady bill's alerts and
   * settling never do, since nothing says the owner set that amount.
   */
  followAfterOn: IsoDate | null
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
 * Whether every charge in the bill's cycle from `first` posted after `day`
 * (the owner last setting its amount, or following beginning); true when
 * there is no such day. A charge on that very day may have come before it,
 * so it does not count: the amount as it stood then stays.
 */
function postedAfter(
  day: IsoDate | null,
  bill: WatchedBill,
  first: BillCharge,
  cycle: number,
): boolean {
  if (day === null) return true
  return cycleCharges(bill.charges, first, cycle).every((charge) => charge.date > day)
}

/**
 * A steady bill's latest cycle against its usual amount and the cycle before:
 * settled when both sit at the new amount, changed when only the latest does.
 * Two in a row settle only when both came after the owner last set the
 * amount; with the first from before, the owner's figure did not take (a
 * downgrade still charged at the old price), so it is changed: news to them.
 */
function steadyBillChange(
  bill: WatchedBill,
  latest: BillCharge,
  previous: BillCharge | undefined,
  cycle: number,
): BillChange | null {
  if (!previous || !isAmountChange(bill.amountCents, latest.amountCents)) return null
  if (missedBetween(previous.date, latest.date, cycle)) return null
  const changed: ChangedBill = {
    kind: 'changed',
    bill,
    charge: latest,
    cycle: cycleCharges(bill.charges, latest, cycle),
  }
  if (!isAmountChange(previous.amountCents, latest.amountCents)) {
    if (!postedAfter(bill.amountSetOn, bill, previous, cycle)) return changed
    return { kind: 'settled', bill, amountCents: latest.amountCents }
  }
  // The first charge since tracking: the usual amount was only an estimate from history.
  if (previous.date <= bill.trackedOn) return null
  return changed
}

/**
 * What a bill's latest cycle says about its amount, or null when nothing:
 * no charge since the bill was tracked or within the last cycle and a half,
 * or, for a steady bill, a total near the usual amount, a missed cycle or no
 * cycle before it, or a change on the first charge since tracking, when the
 * usual amount was only an estimate from history. A bill whose amount varies
 * (flagged when tracked, or by its own history) is never changed, only
 * settled at what its recent cycles say it costs now. A latest cycle with a
 * charge on or before the day the owner last set the amount says nothing.
 */
export function billChangeOf(bill: WatchedBill, today: IsoDate): BillChange | null {
  const cycle = CYCLE_DAYS[bill.cadence]
  const [latest, ...earlier] = cyclesOf(bill.charges, cycle)
  if (!latest || latest.date <= bill.trackedOn) return null
  if (missedBetween(latest.date, today, cycle)) return null
  // The owner set the amount after this cycle came: their figure is newer than it.
  if (!postedAfter(bill.amountSetOn, bill, latest, cycle)) return null
  // Judged by the cycles before the latest, so the latest's own change cannot hide itself.
  const varies = bill.amountVaries || amountsVary(earlier.map((one) => one.amountCents))
  if (varies) {
    // The amount it had when following began stands until a cycle posts after then.
    if (!postedAfter(bill.followAfterOn, bill, latest, cycle)) return null
    return followVaryingBill(bill, latest, earlier, cycle)
  }
  return steadyBillChange(bill, latest, earlier[0], cycle)
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
