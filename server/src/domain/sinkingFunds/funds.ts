// Sinking funds as stored: the yearly or quarterly costs the owner saves
// toward. A fund follows a tracked bill (its name, amount and due dates are
// the bill's, read live) or stands alone with its own. Saving toward one
// never moves money.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../../errors.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { listBills, type Bill } from '../bills.js'
import { billKey, isFundCadence } from './detect.js'
import { FUND_CADENCES, nextDue, shareOf, type FundCadence } from './math.js'

export const fundInputSchema = z
  .object({
    /** A yearly or quarterly bill to save toward; its name, amount and dates are used. */
    billId: z.uuid().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    /** What the cost comes to each time it is due, positive. */
    amountCents: z.number().int().positive().max(100_000_000).optional(),
    cadence: z.enum(FUND_CADENCES).optional(),
    /** When it is next due (or any day it is due); later ones repeat from it. */
    dueDate: isoDateSchema.optional(),
    /** The suggestion it came from (list_sinking_funds), so it is not offered again. */
    sourceKey: z.string().min(1).max(200).optional(),
  })
  .refine(
    (input) =>
      input.billId !== undefined ||
      (input.name !== undefined &&
        input.amountCents !== undefined &&
        input.cadence !== undefined &&
        input.dueDate !== undefined),
    'Give a billId, or a name, amountCents, cadence and dueDate',
  )

export type FundInput = z.infer<typeof fundInputSchema>

export interface SinkingFund {
  id: string
  /** The bill it follows, or null for one standing alone. */
  billId: string | null
  name: string
  amountCents: number
  cadence: FundCadence
  /** The next day it comes due: the bill's own for one following a bill. */
  nextDueDate: IsoDate
  /** Its steady share of one budget period, held back from the budget's room. */
  perPeriodCents: number
}

interface FundRow {
  id: string
  billId: string | null
  name: string | null
  amountCents: number | null
  cadence: FundCadence | null
  anchorDate: IsoDate | null
}

const COLUMNS = `id, bill_id AS "billId", name, amount_cents::int AS "amountCents", cadence,
  anchor_date AS "anchorDate"`

/** What a fund saves toward: the cost's name, amount, cadence and next due date. */
type Cost = Pick<SinkingFund, 'name' | 'amountCents' | 'cadence' | 'nextDueDate'>

/**
 * A stored fund's cost as it reads today: its own, or its bill's. Null for
 * one whose bill is no longer yearly or quarterly: an ordinary bill then,
 * which safe to spend already counts by its due dates.
 */
function costOf(row: FundRow, bills: Bill[], today: IsoDate): Cost | null {
  if (row.billId === null) {
    const own = {
      amountCents: row.amountCents!,
      cadence: row.cadence!,
      anchorDate: row.anchorDate!,
    }
    return { name: row.name!, ...own, nextDueDate: nextDue(own, today) }
  }
  const bill = bills.find((one) => one.id === row.billId)
  if (!bill || !isFundCadence(bill.cadence)) return null
  // Read off the bill itself, so the narrowed cadence carries over.
  return {
    name: bill.name,
    amountCents: bill.amountCents,
    cadence: bill.cadence,
    nextDueDate: bill.nextDueDate,
  }
}

/** A stored fund with its share of a budget period on `period`. */
function fundOf(row: FundRow, bills: Bill[], today: IsoDate, period: Cadence): SinkingFund | null {
  const cost = costOf(row, bills, today)
  if (!cost) return null
  const { name, amountCents, cadence, nextDueDate } = cost
  const perPeriodCents = shareOf(cost, period)
  return { id: row.id, billId: row.billId, name, amountCents, cadence, nextDueDate, perPeriodCents }
}

/** Every fund, the soonest due first, with its share of a budget period on `period`. */
export async function listFunds(db: Db, today: IsoDate, period: Cadence): Promise<SinkingFund[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const { rows } = await db.query<FundRow>(`SELECT ${COLUMNS} FROM sinking_funds`)
  const bills = rows.some((row) => row.billId) ? await listBills(db, today) : []
  return rows
    .flatMap((row) => fundOf(row, bills, today, period) ?? [])
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.name.localeCompare(b.name))
}

/** The fund just added, read back the way listFunds reads it. */
async function readFund(db: Db, id: string, today: IsoDate, period: Cadence): Promise<SinkingFund> {
  const funds = await listFunds(db, today, period)
  return funds.find((fund) => fund.id === id)!
}

/** The bill a fund would follow, which must be tracked and come due yearly or quarterly. */
async function fundBill(db: Db, billId: string, today: IsoDate): Promise<Bill> {
  const bill = (await listBills(db, today)).find((one) => one.id === billId)
  if (!bill) throw notFound('Bill')
  if (!isFundCadence(bill.cadence)) {
    throw new AppError('invalid_input', `${bill.name} comes due more often than every 3 months`)
  }
  return bill
}

/** Adds a fund. One for a bill or suggestion already added is refused, so a double tap adds it once. */
export async function createFund(
  db: Db,
  input: FundInput,
  today: IsoDate,
  period: Cadence,
): Promise<SinkingFund> {
  const bill = input.billId ? await fundBill(db, input.billId, today) : null
  try {
    const { rows } = bill
      ? await db.query<{ id: string }>(
          'INSERT INTO sinking_funds (bill_id) VALUES ($1) RETURNING id',
          [bill.id],
        )
      : await db.query<{ id: string }>(
          `INSERT INTO sinking_funds (name, amount_cents, cadence, anchor_date, source_key)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [input.name, input.amountCents, input.cadence, input.dueDate, input.sourceKey ?? null],
        )
    return await readFund(db, rows[0]!.id, today, period)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('conflict', `${bill?.name ?? input.name} is already a sinking fund`)
    }
    throw error
  }
}

export async function deleteFund(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM sinking_funds WHERE id = $1', [id])
  if (!rowCount) throw notFound('Sinking fund')
}

/** Stops suggesting a cost, by its suggestion's key. */
export async function dismissFundSuggestion(db: Db, key: string): Promise<void> {
  await db.query(
    'INSERT INTO sinking_fund_dismissals (source_key) VALUES ($1) ON CONFLICT DO NOTHING',
    [key],
  )
}

/** The suggestion keys already added or dismissed, which are not suggested again. */
export async function settledKeys(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string | null; billId: string | null }>(
    `SELECT source_key AS key, bill_id AS "billId" FROM sinking_funds
     UNION ALL SELECT source_key, NULL FROM sinking_fund_dismissals`,
  )
  // A fund that follows a bill settles that bill's suggestion, keyed the way it was offered.
  const keys = rows.map((row) => (row.billId ? billKey(row.billId) : row.key))
  return new Set(keys.filter((key) => key !== null))
}
