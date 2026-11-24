// Reads each bill's last few posted charges to see whether its amount
// changed (billChanges.ts), and writes the new usual amount once the owner
// dismisses the alert, the new amount comes twice in a row, or a varying
// bill's recent cycles say it costs something else now. None of these
// writes counts as the owner setting the amount (amount_set_at): only
// update_bill does. Each write lands only on the amount it was worked out
// from, so an owner's edit made meanwhile is never overwritten (setUsual).

import type { Db } from '../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import type { AccountAlert, AlertFormat } from './accountAlerts.js'
import { accountMasks } from './accounts.js'
import { isAmountChange } from './billAmountChange.js'
import { PAYMENT } from './billPayments.js'
import {
  billChangeAlert,
  billChangeOf,
  CHARGES_READ,
  type BillChange,
  type WatchedBill,
} from './billChanges.js'
import { paidOnceCents, type BillCharge } from './billCycles.js'
import { textKey } from './merchantKey.js'
import { shownNamesOf } from './ruleText.js'
import type { RuleReads } from './rules.js'
import type { Movement } from './transfers.js'

/** How far back charges are read: two yearly charges, as bills' own matching reads. */
const LOOKBACK_DAYS = 400

/** A bill as stored, with its bank-text charges already found. */
interface BillAndCharges {
  id: string
  name: string
  amountCents: number
  cadence: Cadence
  reads: RuleReads
  matchPattern: string
  createdAt: Date
  amountVaries: boolean
  /** When the owner last set the amount; null when never since tracking. */
  amountSetAt: Date | null
  /** When following began, for a bill whose amount was there before then (035). */
  followAfter: Date | null
  /** The same, to the microsecond, as setUsual compares it; a Date keeps only milliseconds. */
  amountSetStamp: string | null
  charges: BillCharge[]
}

/**
 * Bills with a pattern, each with its last few posted charges matched in the
 * bank's text. Bills that read shown names are matched afterwards.
 */
async function billsWithCharges(db: Db, today: IsoDate): Promise<BillAndCharges[]> {
  const { rows } = await db.query<BillAndCharges>(
    `SELECT b.id, b.name, b.amount_cents::int AS "amountCents", b.cadence, b.reads,
       b.match_pattern AS "matchPattern", b.created_at AS "createdAt",
       b.amount_varies AS "amountVaries", b.amount_set_at AS "amountSetAt",
       b.follow_after AS "followAfter",
       to_char(b.amount_set_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         AS "amountSetStamp",
       coalesce(json_agg(json_build_object('accountId', p.account_id,
         'date', to_char(p.date, 'YYYY-MM-DD'), 'amountCents', p.amount_cents)
         ORDER BY p.date DESC) FILTER (WHERE p.date IS NOT NULL), '[]') AS charges
     FROM bills b
     LEFT JOIN LATERAL (
       SELECT t.account_id, t.date, t.amount_cents FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE b.reads = 'bank_text' AND ${PAYMENT} AND NOT t.pending
         AND t.date BETWEEN $2 AND $1
         AND position(merchant_key(b.match_pattern)
           IN merchant_key(coalesce(t.merchant_name, '') || ' ' || t.name)) > 0
       ORDER BY t.date DESC, t.id LIMIT ${CHARGES_READ}
     ) p ON true
     WHERE b.match_pattern IS NOT NULL
     GROUP BY b.id`,
    [today, addDays(today, -LOOKBACK_DAYS)],
  )
  return rows
}

/** A posted payment, as its shown name is worked out. */
interface Payment extends Movement, BillCharge {}

/** For bills that read shown names: their last few charges, found by shown name. */
async function byShownName(
  db: Db,
  bills: BillAndCharges[],
  today: IsoDate,
): Promise<BillAndCharges[]> {
  if (!bills.some((bill) => bill.reads === 'shown_name')) return bills
  const [{ rows }, masks] = await Promise.all([
    db.query<Payment>(
      `SELECT t.account_id AS "accountId", to_char(t.date, 'YYYY-MM-DD') AS date, t.name,
         t.merchant_name AS "merchantName", t.amount_cents::int AS "amountCents",
         t.provider_category_primary AS "providerCategoryPrimary",
         t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType"
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE ${PAYMENT} AND NOT t.pending AND t.date BETWEEN $2 AND $1
       ORDER BY t.date DESC, t.id`,
      [today, addDays(today, -LOOKBACK_DAYS)],
    ),
    accountMasks(db),
  ])
  // Every name a payment was shown under, so a pattern saved from an earlier one still finds it.
  const keyed = rows.map((payment) => ({
    payment,
    keys: shownNamesOf(payment, masks).map(textKey),
  }))
  return bills.map((bill) => {
    if (bill.reads !== 'shown_name') return bill
    const pattern = textKey(bill.matchPattern)
    const charges = keyed
      .filter(({ keys }) => pattern && keys.some((key) => key.includes(pattern)))
      .slice(0, CHARGES_READ)
      .map(({ payment: { accountId, date, amountCents } }) => ({ accountId, date, amountCents }))
    return { ...bill, charges }
  })
}

/** A bill's amount as it was read, which a new usual amount may only replace (setUsual). */
interface AmountRead {
  amountCents: number
  amountSetStamp: string | null
}

/**
 * Every bill's change, with the amount each bill was read with, by bill id.
 * Every change comes from a bill read, so each has its read.
 */
async function readBillChanges(
  db: Db,
  timeZone: string,
  today: IsoDate,
): Promise<{ changes: BillChange[]; reads: Map<string, AmountRead> }> {
  const bills = await byShownName(db, await billsWithCharges(db, today), today)
  const reads = new Map(
    bills.map((bill) => [
      bill.id,
      { amountCents: bill.amountCents, amountSetStamp: bill.amountSetStamp },
    ]),
  )
  const changes = bills
    .map((bill): WatchedBill => ({
      id: bill.id,
      name: bill.name,
      amountCents: bill.amountCents,
      cadence: bill.cadence,
      trackedOn: todayIn(timeZone, bill.createdAt),
      amountVaries: bill.amountVaries,
      amountSetOn: bill.amountSetAt ? todayIn(timeZone, bill.amountSetAt) : null,
      followAfterOn: bill.followAfter ? todayIn(timeZone, bill.followAfter) : null,
      charges: bill.charges,
    }))
    .map((bill) => billChangeOf(bill, today))
    .filter((change) => change !== null)
  return { changes, reads }
}

/** What every bill's latest charge says about its amount, nothing included. */
export async function listBillChanges(
  db: Db,
  timeZone: string,
  today: IsoDate,
): Promise<BillChange[]> {
  return (await readBillChanges(db, timeZone, today)).changes
}

/** The alerts for changed charges on these accounts, each named as the app names it. */
export function billChangeAlerts(
  changes: BillChange[],
  accountNames: Map<string, string>,
  format: Pick<AlertFormat, 'money'>,
): AccountAlert[] {
  return changes.flatMap((change) => {
    if (change.kind !== 'changed') return []
    const name = accountNames.get(change.charge.accountId)
    return name === undefined ? [] : [billChangeAlert(change, name, format)]
  })
}

/**
 * Writes a bill's new usual amount, only over the amount it was worked out
 * from. An update_bill that lands between the read and this write changes
 * the amount or when it was set, so the owner's figure stays and this write
 * is skipped quietly: the next refresh reads the bill afresh. True when it
 * wrote.
 */
async function setUsual(
  db: Db,
  billId: string,
  amountCents: number,
  read: AmountRead,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE bills SET amount_cents = $2
     WHERE id = $1 AND amount_cents = $3 AND amount_set_at IS NOT DISTINCT FROM $4::timestamptz`,
    [billId, amountCents, read.amountCents, read.amountSetStamp],
  )
  return rowCount === 1
}

/**
 * Writes each settled bill's new usual amount: a steady bill charged it twice
 * in a row, which clears its alert, or a varying bill following its recent
 * cycles. Returns how many bills it wrote, leaving out any the owner changed
 * meanwhile.
 */
export async function settleBillChanges(db: Db, timeZone: string, today: IsoDate): Promise<number> {
  const { changes, reads } = await readBillChanges(db, timeZone, today)
  let written = 0
  for (const change of changes) {
    if (change.kind !== 'settled') continue
    const { id } = change.bill
    if (await setUsual(db, id, change.amountCents, reads.get(id)!)) written += 1
  }
  return written
}

/**
 * Takes a changed cycle's amount as the bill's usual one, as dismissing or
 * hiding its alert does, so the alert clears and never comes back for that
 * charge. A charge made twice in the cycle counts once (paidOnceCents), so
 * the usual amount never becomes a doubled total. False when nothing was
 * learned: the bill's latest charge is no longer a change, its cycle was
 * only paid twice and costs the usual amount paid once, or the owner changed
 * the amount meanwhile.
 */
export async function acceptBillChange(
  db: Db,
  timeZone: string,
  today: IsoDate,
  target: { billId: string; date: IsoDate },
): Promise<boolean> {
  const { changes, reads } = await readBillChanges(db, timeZone, today)
  const change = changes.find(
    (one) =>
      one.kind === 'changed' && one.bill.id === target.billId && one.charge.date === target.date,
  )
  if (change?.kind !== 'changed') return false
  const usualCents = paidOnceCents(change.cycle)
  if (!isAmountChange(change.bill.amountCents, usualCents)) return false
  return setUsual(db, change.bill.id, usualCents, reads.get(change.bill.id)!)
}
