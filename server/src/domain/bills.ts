// Bills and subscriptions: what is due when, and whether it has been paid.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import { addDays, daysBetween, isIsoDate, maxDate, type IsoDate } from '../lib/dates.js'
import { convertCadence, type Cadence } from '../lib/periods.js'
import { lastBefore, nextOnOrAfter, occurrences } from '../lib/schedule.js'
import { patchOf } from '../lib/schemas.js'
import { assertCategoryExists } from './categories.js'

export const BILL_CADENCES = ['week', 'biweek', 'semimonth', 'month', 'quarter', 'year'] as const

export const billInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['bill', 'subscription']).default('bill'),
  /** The usual amount, positive. */
  amountCents: z.number().int().positive(),
  cadence: z.enum(BILL_CADENCES),
  /** The first due date to track; later ones repeat from it by cadence. */
  anchorDate: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD'),
  /**
   * Text found in the merchant or description of the transaction that pays
   * it, such as "netflix". Case, digits and punctuation are ignored. Without
   * one, Leeway cannot tell when it was paid.
   */
  matchPattern: z
    .string()
    .trim()
    .max(100)
    // Matching ignores digits and punctuation, so the pattern needs a letter to match anything.
    .regex(/[a-z]/i, 'Use some letters from the merchant name, like "netflix"')
    .nullable()
    .default(null),
  categoryId: z.uuid().nullable().default(null),
  /** Paid automatically, so a late-posting payment is not flagged as overdue. */
  autopay: z.boolean().default(false),
})

export const billPatchSchema = patchOf(billInputSchema)

export type BillInput = z.infer<typeof billInputSchema>

/** A stored bill and the last transaction that paid it. */
interface BillRow extends BillInput {
  id: string
  lastPaidDate: IsoDate | null
  lastPaidCents: number | null
}

export type BillStatus = 'paid' | 'overdue' | 'due_soon' | 'upcoming'

export interface Bill extends BillRow {
  /** The next due date not yet covered by a payment. */
  nextDueDate: IsoDate
  daysUntilDue: number
  /** "paid" when the most recent due date was paid and the next is not close yet. */
  status: BillStatus
  /** The amount spread over a month, to compare bills on different cadences. */
  monthlyCents: number
}

/** Bills due within this many days are "due soon". */
export const DUE_SOON_DAYS = 7

/**
 * How many days before a due date a payment still counts toward it. Shorter
 * for weekly bills, so one payment never covers two due dates.
 */
const EARLY_DAYS: Record<Cadence, number> = {
  week: 3,
  biweek: 7,
  semimonth: 7,
  month: 10,
  quarter: 10,
  year: 10,
}

/** Whether the bill's latest payment counts toward the due date `due`. */
function covers(bill: BillRow, due: IsoDate): boolean {
  return bill.lastPaidDate !== null && bill.lastPaidDate >= addDays(due, -EARLY_DAYS[bill.cadence])
}

/**
 * Whether the most recent past due date still needs paying. Only bills with a
 * match pattern can show that, and autopay bills are assumed paid.
 */
function previousIsOpen(bill: BillRow, today: IsoDate): IsoDate | null {
  if (bill.anchorDate >= today || bill.autopay || !bill.matchPattern) return null
  const previous = lastBefore(bill.anchorDate, bill.cadence, today)
  return covers(bill, previous) ? null : previous
}

/** Where a bill stands today: its next unpaid due date and a status for it. */
export function scheduleOf(bill: BillRow, today: IsoDate): Bill {
  const overdue = previousIsOpen(bill, today)
  let nextDueDate =
    overdue ?? nextOnOrAfter(bill.anchorDate, bill.cadence, maxDate(today, bill.anchorDate))
  // A payment made early for the coming due date moves it on to the one after.
  if (!overdue && covers(bill, nextDueDate)) {
    nextDueDate = nextOnOrAfter(bill.anchorDate, bill.cadence, addDays(nextDueDate, 1))
  }
  const daysUntilDue = daysBetween(today, nextDueDate)
  return {
    ...bill,
    nextDueDate,
    daysUntilDue,
    status: statusOf(bill, today, daysUntilDue, overdue !== null),
    monthlyCents: convertCadence(bill.amountCents, bill.cadence, 'month'),
  }
}

function statusOf(bill: BillRow, today: IsoDate, daysUntilDue: number, overdue: boolean) {
  if (overdue) return 'overdue'
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon'
  // The latest due date (today or earlier) was paid, and the next is not close.
  const latestDue = lastBefore(bill.anchorDate, bill.cadence, addDays(today, 1))
  return covers(bill, latestDue) ? 'paid' : 'upcoming'
}

/**
 * Unpaid due dates before `until` (not included), starting with the next one,
 * which may be overdue. This is what still has to come out of the bank by then.
 */
export function dueBefore(bill: Bill, until: IsoDate): IsoDate[] {
  if (bill.nextDueDate >= until) return []
  const from = addDays(bill.nextDueDate, 1)
  return [bill.nextDueDate, ...occurrences(bill.anchorDate, bill.cadence, from, addDays(until, -1))]
}

const SELECT = `
  SELECT b.id, b.name, b.kind, b.amount_cents AS "amountCents", b.cadence,
    b.anchor_date AS "anchorDate", b.match_pattern AS "matchPattern",
    b.category_id AS "categoryId", b.autopay,
    paid.date AS "lastPaidDate", paid.amount_cents AS "lastPaidCents"
  FROM bills b
  -- The newest counted payment whose merchant or description contains the pattern.
  LEFT JOIN LATERAL (
    SELECT t.date, t.amount_cents FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE b.match_pattern IS NOT NULL AND t.amount_cents > 0 AND NOT t.excluded AND NOT a.hidden
      AND t.date <= $1
      AND position(
        merchant_key(b.match_pattern) IN merchant_key(coalesce(t.merchant_name, '') || ' ' || t.name)
      ) > 0
    ORDER BY t.date DESC LIMIT 1
  ) paid ON true`

/** Every bill, soonest due first. */
export async function listBills(db: Db, today: IsoDate): Promise<Bill[]> {
  const { rows } = await db.query<BillRow>(SELECT, [today])
  return rows
    .map((row) => scheduleOf(row, today))
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.name.localeCompare(b.name))
}

export async function getBill(db: Db, id: string, today: IsoDate): Promise<Bill> {
  const { rows } = await db.query<BillRow>(`${SELECT} WHERE b.id = $2`, [today, id])
  if (!rows[0]) throw notFound('Bill')
  return scheduleOf(rows[0], today)
}

export async function createBill(db: Db, input: BillInput, today: IsoDate): Promise<Bill> {
  if (input.categoryId) await assertCategoryExists(db, input.categoryId)
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bills (name, kind, amount_cents, cadence, anchor_date, match_pattern, category_id, autopay)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.name,
      input.kind,
      input.amountCents,
      input.cadence,
      input.anchorDate,
      input.matchPattern,
      input.categoryId,
      input.autopay,
    ],
  )
  return getBill(db, rows[0]!.id, today)
}

export async function updateBill(
  db: Db,
  id: string,
  patch: z.infer<typeof billPatchSchema>,
  today: IsoDate,
): Promise<Bill> {
  const current = await getBill(db, id, today)
  if (patch.categoryId) await assertCategoryExists(db, patch.categoryId)
  const next = { ...current, ...patch }
  await db.query(
    `UPDATE bills SET name = $2, kind = $3, amount_cents = $4, cadence = $5, anchor_date = $6,
       match_pattern = $7, category_id = $8, autopay = $9
     WHERE id = $1`,
    [
      id,
      next.name,
      next.kind,
      next.amountCents,
      next.cadence,
      next.anchorDate,
      next.matchPattern,
      next.categoryId,
      next.autopay,
    ],
  )
  return getBill(db, id, today)
}

export async function deleteBill(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM bills WHERE id = $1', [id])
  if (!rowCount) throw notFound('Bill')
}
