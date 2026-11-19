// Saving a paystub the owner reviewed: the figures they confirmed, and, when
// they choose, those figures applied to a pension and to the monthly
// retirement contribution. Nothing is saved until the owner says so, and the
// file itself never is.

import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError, notFound } from '../../errors.js'
import { convertCadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import {
  updatePension,
  PAY_CADENCES,
  type Pension,
  type PensionPlanPatch,
} from '../retirement/pensions.js'
import { getSettings, mergeSettings, saveSettings } from '../settings.js'
import { MAX_EMPLOYER_LENGTH } from './redact.js'
import {
  CURRENT_FIELDS,
  YEAR_TO_DATE_FIELDS,
  type CurrentField,
  type PayCadence,
  type YearToDateField,
} from './reading.js'

/** Paystubs kept: a year of weekly pay. Older ones are let go as new ones come in. */
export const MAX_PAYSTUBS = 52

/** One confirmed figure in cents, or null when the paystub did not show it. */
const figureCents = z
  .number()
  .int('Use whole cents')
  .min(0, 'A figure cannot be negative')
  .max(100_000_000, 'Use $1,000,000 or less')
  .nullable()

/** An object with one figure for each field named, every one required so nothing is left out by mistake. */
function figuresSchema<F extends string>(fields: readonly F[]) {
  return z.object(
    Object.fromEntries(fields.map((field) => [field, figureCents])) as Record<
      F,
      typeof figureCents
    >,
  )
}

/** The paystub as the owner confirmed it. */
export const paystubSchema = z
  .object({
    employerName: z.string().trim().max(MAX_EMPLOYER_LENGTH).nullable(),
    payDate: isoDateSchema.nullable(),
    periodStart: isoDateSchema.nullable(),
    periodEnd: isoDateSchema.nullable(),
    payCadence: z.enum(PAY_CADENCES).nullable(),
    current: figuresSchema(CURRENT_FIELDS),
    yearToDate: figuresSchema(YEAR_TO_DATE_FIELDS),
  })
  .refine(
    ({ current }) =>
      current.grossPay === null || current.netPay === null || current.netPay <= current.grossPay,
    { message: 'Take-home pay cannot be more than gross pay', path: ['current', 'netPay'] },
  )

export type Paystub = z.infer<typeof paystubSchema>

/** Saving a paystub, and where else its figures go. */
export const savePaystubSchema = z.object({
  paystub: paystubSchema,
  /** The pension to update with this paystub's pension figures; null leaves every pension as it is. */
  pensionAccountId: z.uuid().nullable().default(null),
  /** Whether the 401(k), 457 and 403(b) figures become the monthly retirement contribution. */
  setRetirementContribution: z.boolean().default(false),
})

export type SavePaystub = z.infer<typeof savePaystubSchema>

/** A saved paystub. */
export interface SavedPaystub extends Paystub {
  id: string
  pensionAccountId: string | null
  savedAt: string
}

/** What saving changed besides the paystub itself. */
export interface PaystubSaved {
  paystub: SavedPaystub
  /** The pension as it now stands, when one was chosen. */
  pension: Pension | null
  /** The monthly retirement contribution now set, when it was. */
  retirementMonthlyContributionCents: number | null
}

/** The employee's own workplace plan contributions, which go into retirement savings. */
const PLAN_FIELDS = ['plan401k', 'plan457', 'plan403b'] as const satisfies CurrentField[]

/** A share of gross pay in percent, to two places, as the pension form takes it. */
function percentOfPay(cents: number, grossCents: number): number {
  return Math.min(100, Math.round((cents / grossCents) * 10_000) / 100)
}

/**
 * The pension details this paystub shows: what was paid in, gross pay, how
 * often pay comes, and the employer's share as a percent of gross pay. A
 * figure the paystub did not show leaves the pension's own as it is.
 */
export function pensionPatchFrom(paystub: Paystub): PensionPlanPatch {
  const { grossPay, pension, pensionEmployer } = paystub.current
  const patch: PensionPlanPatch = {}
  if (pension !== null) patch.contribution = { kind: 'amount', cents: pension }
  const hasGross = grossPay !== null && grossPay > 0
  if (hasGross) patch.grossPayCents = grossPay
  if (paystub.payCadence !== null) patch.payCadence = paystub.payCadence
  if (hasGross && pensionEmployer !== null) {
    patch.employerContributionPercent = percentOfPay(pensionEmployer, grossPay)
  }
  return patch
}

/**
 * The monthly retirement contribution this paystub shows: its 401(k), 457 and
 * 403(b) figures added up and turned into a month of pay. An error when the
 * paystub shows none of them, or does not say how often pay comes.
 */
export function monthlyPlanContribution(paystub: Paystub): number {
  const shown = PLAN_FIELDS.map((field) => paystub.current[field]).filter((cents) => cents !== null)
  if (shown.length === 0) {
    throw new AppError('invalid_input', 'This paystub shows no 401(k), 457 or 403(b) contribution.')
  }
  if (paystub.payCadence === null) {
    throw new AppError('invalid_input', 'Choose how often you are paid to work out a month of it.')
  }
  const perPaycheck = shown.reduce((sum, cents) => sum + cents, 0)
  return convertCadence(perPaycheck, paystub.payCadence, 'month')
}

interface PaystubRow {
  id: string
  employerName: string | null
  payDate: string | null
  periodStart: string | null
  periodEnd: string | null
  payCadence: PayCadence | null
  currentCents: Record<CurrentField, number | null>
  yearToDateCents: Record<YearToDateField, number | null>
  pensionAccountId: string | null
  savedAt: Date
}

const SELECT_PAYSTUB = `SELECT id, employer_name AS "employerName", pay_date AS "payDate",
    period_start AS "periodStart", period_end AS "periodEnd", pay_cadence AS "payCadence",
    current_cents AS "currentCents", year_to_date_cents AS "yearToDateCents",
    pension_account_id AS "pensionAccountId", created_at AS "savedAt"
  FROM paystubs`

const NEWEST_FIRST = 'ORDER BY pay_date DESC NULLS LAST, created_at DESC'

function paystubFromRow(row: PaystubRow): SavedPaystub {
  return {
    id: row.id,
    employerName: row.employerName,
    payDate: row.payDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payCadence: row.payCadence,
    current: row.currentCents,
    yearToDate: row.yearToDateCents,
    pensionAccountId: row.pensionAccountId,
    savedAt: row.savedAt.toISOString(),
  }
}

/** The newest saved paystub, by the day it was paid, or null when none is saved. */
export async function latestPaystub(db: Db): Promise<SavedPaystub | null> {
  const { rows } = await db.query<PaystubRow>(`${SELECT_PAYSTUB} ${NEWEST_FIRST} LIMIT 1`)
  return rows[0] ? paystubFromRow(rows[0]) : null
}

async function insertPaystub(db: Db, paystub: Paystub, pensionAccountId: string | null) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO paystubs (employer_name, pay_date, period_start, period_end, pay_cadence,
       current_cents, year_to_date_cents, pension_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      paystub.employerName === '' ? null : paystub.employerName,
      paystub.payDate,
      paystub.periodStart,
      paystub.periodEnd,
      paystub.payCadence,
      JSON.stringify(paystub.current),
      JSON.stringify(paystub.yearToDate),
      pensionAccountId,
    ],
  )
  // Past the limit, the oldest paystubs go.
  await db.query(
    `DELETE FROM paystubs WHERE id NOT IN (SELECT id FROM paystubs ${NEWEST_FIRST} LIMIT $1)`,
    [MAX_PAYSTUBS],
  )
  const saved = await db.query<PaystubRow>(`${SELECT_PAYSTUB} WHERE id = $1`, [rows[0]!.id])
  return paystubFromRow(saved.rows[0]!)
}

/** Sets the monthly retirement contribution, leaving every other assumption as it is. */
async function setRetirementContribution(db: Db, monthlyCents: number): Promise<void> {
  const settings = await getSettings(db)
  const retirement = { monthlyContributionCents: monthlyCents }
  await saveSettings(db, mergeSettings(settings, { retirement }))
}

/**
 * Saves a paystub the owner confirmed and, as they chose, applies it to a
 * pension and to the monthly retirement contribution, all or nothing.
 */
export async function savePaystub(pool: pg.Pool, input: SavePaystub): Promise<PaystubSaved> {
  return withTransaction(pool, async (db) => {
    const { paystub, pensionAccountId } = input
    const contribution = input.setRetirementContribution ? monthlyPlanContribution(paystub) : null
    const pension =
      pensionAccountId === null
        ? null
        : await updatePension(db, pensionAccountId, pensionPatchFrom(paystub))
    if (contribution !== null) await setRetirementContribution(db, contribution)
    return {
      paystub: await insertPaystub(db, paystub, pensionAccountId),
      pension,
      retirementMonthlyContributionCents: contribution,
    }
  })
}

/** Deletes a saved paystub. A pension or contribution it set keeps its figures. */
export async function deletePaystub(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM paystubs WHERE id = $1', [id])
  if (rowCount === 0) throw notFound('Paystub')
}
