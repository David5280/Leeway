// A bill that cost more or less than usual: its latest charge, compared with
// the amount the bill expects. Pure: the bills and their last few charges
// come in, changes come out; billChangeSource.ts reads and writes them.
//
// A change is an account alert of its own kind (bill_change), so it shows,
// notifies, hides and dismisses as the other alerts do. Dismissing or hiding
// it takes the new amount as the bill's usual one, and so does a second
// charge in a row at the new amount: either way the alert clears, and the
// same charge is never news twice.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import type { AccountAlert, AlertFormat } from './accountAlerts.js'

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

/** Charges read per bill: enough to find the last cycle's past a second payment in this one. */
export const CHARGES_READ = 4

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
  /** Its last few posted charges (CHARGES_READ), newest first. */
  charges: BillCharge[]
}

export type BillChange =
  /** The latest charge is news: well off the usual amount. */
  | { kind: 'changed'; bill: WatchedBill; charge: BillCharge }
  /** Two charges in a row at the new amount: it is the usual one now. */
  | { kind: 'settled'; bill: WatchedBill; amountCents: number }

/**
 * What a bill's latest charge says about its amount, or null when nothing:
 * the charge is near the usual amount, a cycle was missed between charges or
 * since the latest, or it is the first charge since the bill was tracked,
 * when the usual amount was only an estimate from history.
 */
export function billChangeOf(bill: WatchedBill, today: IsoDate): BillChange | null {
  const [latest] = bill.charges
  if (!latest || latest.date <= bill.trackedOn) return null
  if (!isAmountChange(bill.amountCents, latest.amountCents)) return null
  const cycle = CYCLE_DAYS[bill.cadence]
  // The last cycle's charge: one only days before the latest (a split or second payment) is this cycle's.
  const previous = bill.charges.find((charge) => daysBetween(charge.date, latest.date) >= cycle / 2)
  if (!previous) return null
  const span = cycle * MISSED_CYCLES
  if (daysBetween(previous.date, latest.date) > span || daysBetween(latest.date, today) > span) {
    return null
  }
  if (!isAmountChange(previous.amountCents, latest.amountCents)) {
    return { kind: 'settled', bill, amountCents: latest.amountCents }
  }
  if (previous.date <= bill.trackedOn) return null
  return { kind: 'changed', bill, charge: latest }
}

/**
 * The alert for a changed charge, naming the bill and the amounts only: no
 * account, so no account's name or number reaches the inbox, an email or an
 * assistant through its words. A higher charge is a warning; a lower one is
 * only worth knowing.
 */
export function billChangeAlert(
  { bill, charge }: Extract<BillChange, { kind: 'changed' }>,
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
