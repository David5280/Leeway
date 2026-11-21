// Sinking funds as stored: the yearly or quarterly costs the owner saves
// toward, each with its steady share per budget period (math.ts). A fund's
// share comes out of the budget's room the way a goal set aside does (see
// setAsides in budgetReport.ts). Saving toward one never moves money.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../../errors.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { FUND_CADENCES, nextDue, shareOf } from './math.js'

export const fundInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** What the cost comes to each time it is due, positive. */
  amountCents: z.number().int().positive().max(100_000_000),
  cadence: z.enum(FUND_CADENCES),
  /** When it is next due (or any day it is due); later ones repeat from it. */
  dueDate: isoDateSchema,
  /** The suggestion it came from (find_sinking_funds), so it is not offered again. */
  sourceKey: z.string().min(1).max(200).nullable().default(null),
})

export type FundInput = z.infer<typeof fundInputSchema>

export interface SinkingFund {
  id: string
  name: string
  amountCents: number
  cadence: FundInput['cadence']
  /** The next day it comes due, today or later. */
  nextDueDate: IsoDate
  /** Its steady share of one budget period, held back from the budget's room. */
  perPeriodCents: number
  sourceKey: string | null
}

interface FundRow {
  id: string
  name: string
  amountCents: number
  cadence: FundInput['cadence']
  anchorDate: IsoDate
  sourceKey: string | null
}

/** A stored fund with its next due date and its share of a budget period on `periodCadence`. */
export function fundOf(row: FundRow, today: IsoDate, periodCadence: Cadence): SinkingFund {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    cadence: row.cadence,
    nextDueDate: nextDue(row, today),
    perPeriodCents: shareOf(row, periodCadence),
    sourceKey: row.sourceKey,
  }
}

/** Every fund, the soonest due first. */
export async function listFunds(
  db: Db,
  today: IsoDate,
  periodCadence: Cadence,
): Promise<SinkingFund[]> {
  const { rows } = await db.query<FundRow>(
    `SELECT id, name, amount_cents::int AS "amountCents", cadence, anchor_date AS "anchorDate",
       source_key AS "sourceKey"
     FROM sinking_funds ORDER BY created_at, name`,
  )
  return rows
    .map((row) => fundOf(row, today, periodCadence))
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.name.localeCompare(b.name))
}

/** Adds a fund. One from a suggestion already added is refused, so a double tap adds it once. */
export async function createFund(
  db: Db,
  input: FundInput,
  today: IsoDate,
  periodCadence: Cadence,
): Promise<SinkingFund> {
  try {
    const { rows } = await db.query<FundRow>(
      `INSERT INTO sinking_funds (name, amount_cents, cadence, anchor_date, source_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, amount_cents::int AS "amountCents", cadence,
         anchor_date AS "anchorDate", source_key AS "sourceKey"`,
      [input.name, input.amountCents, input.cadence, input.dueDate, input.sourceKey],
    )
    return fundOf(rows[0]!, today, periodCadence)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('conflict', `${input.name} is already a sinking fund`)
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
  const { rows } = await db.query<{ key: string }>(
    `SELECT source_key AS key FROM sinking_funds WHERE source_key IS NOT NULL
     UNION SELECT source_key FROM sinking_fund_dismissals`,
  )
  return new Set(rows.map((row) => row.key))
}
