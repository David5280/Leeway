// A bill that cost more or less than usual: its latest cycle's charges,
// added up, compared with the amount the bill expects. Pure: the bills and
// their last few charges come in, changes come out; billChangeSource.ts reads
// and writes them.
//
// A bill whose amount moves by nature, like power or water, is never news.
// Its own charges say so: a steady bill's amount sits still between price
// changes, while a utility's keeps moving from cycle to cycle. So a bill whose
// earlier cycles moved in most steps is left quiet, however it was added (one
// tap, the form or an assistant); see amountsVary.
//
// A change is an account alert of its own kind (bill_change), so it shows,
// notifies, hides and dismisses as the other alerts do. Dismissing or hiding
// it takes the new amount as the bill's usual one, and so does a second
// charge in a row at the new amount: either way the alert clears, and the
// same charge is never news twice.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import type { AccountAlert, AlertFormat } from './accountAlerts.js'
import { DUPLICATE_DAYS } from './leaks/duplicates.js'

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

/** About how many days apart each cadence's charges come. */
const CYCLE_DAYS: Record<Cadence, number> = {
  week: 7,
  biweek: 14,
  semimonth: 15,
  month: 31,
  quarter: 92,
  year: 366,
}

/** A gap past this many cycles between charges means one was missed. */
const MISSED_CYCLES = 1.5

/** Charges read per bill: about a year of monthly cycles, fewer when cycles are paid in parts. */
export const CHARGES_READ = 12

/** Moves needed before a bill's own history can say its amount varies, so three cycles at least. */
export const VARIES_AFTER_MOVES = 2

/** A posted charge that paid a bill. */
export interface BillCharge {
  accountId: string
  date: IsoDate
  /** Positive: what the charge cost. */
  amountCents: number
}

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
  /** Its last few posted charges (CHARGES_READ), newest first. */
  charges: BillCharge[]
}

export type BillChange =
  /**
   * The latest cycle is news: well off the usual amount. `charge` is its
   * latest, with the cycle's total; `cycle` the charges added up, newest first.
   */
  | { kind: 'changed'; bill: WatchedBill; charge: BillCharge; cycle: BillCharge[] }
  /** Two charges in a row at the new amount: it is the usual one now. */
  | { kind: 'settled'; bill: WatchedBill; amountCents: number }

/** A cycle that is news (BillChange's 'changed'). */
export type ChangedBill = Extract<BillChange, { kind: 'changed' }>

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

/** What a cycle cost paid once: its charges added up, the repeats left out (withoutRepeats). */
export function paidOnceCents(cycle: BillCharge[]): number {
  return withoutRepeats(cycle).reduce((sum, charge) => sum + charge.amountCents, 0)
}

/**
 * One cycle's charges from `first` (newest first) on: those within half a
 * cycle before it, as a split or second payment is.
 */
function cycleCharges(charges: BillCharge[], first: BillCharge, cycle: number): BillCharge[] {
  return charges.filter(
    (charge) => charge.date <= first.date && daysBetween(charge.date, first.date) < cycle / 2,
  )
}

/** One cycle's charges from `first` on (cycleCharges), added up as one. */
function cycleFrom(charges: BillCharge[], first: BillCharge, cycle: number): BillCharge {
  const within = cycleCharges(charges, first, cycle)
  return { ...first, amountCents: within.reduce((sum, charge) => sum + charge.amountCents, 0) }
}

/** Every cycle in `charges` (newest first), each added up as one charge, newest first. */
function cyclesOf(charges: BillCharge[], cycle: number): BillCharge[] {
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
 * What a bill's latest cycle says about its amount, or null when nothing:
 * the bill's amount varies by nature, the cycle's total is near the usual
 * amount, a cycle was missed between charges or since the latest, or it is
 * the first charge since the bill was tracked, when the usual amount was only
 * an estimate from history.
 */
export function billChangeOf(bill: WatchedBill, today: IsoDate): BillChange | null {
  if (bill.amountVaries) return null
  const cycle = CYCLE_DAYS[bill.cadence]
  const [latest, previous, ...older] = cyclesOf(bill.charges, cycle)
  if (!latest || latest.date <= bill.trackedOn) return null
  if (!isAmountChange(bill.amountCents, latest.amountCents) || !previous) return null
  const span = cycle * MISSED_CYCLES
  if (daysBetween(previous.date, latest.date) > span || daysBetween(latest.date, today) > span) {
    return null
  }
  if (amountsVary([previous, ...older].map((one) => one.amountCents))) return null
  if (!isAmountChange(previous.amountCents, latest.amountCents)) {
    return { kind: 'settled', bill, amountCents: latest.amountCents }
  }
  if (previous.date <= bill.trackedOn) return null
  return { kind: 'changed', bill, charge: latest, cycle: cycleCharges(bill.charges, latest, cycle) }
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
