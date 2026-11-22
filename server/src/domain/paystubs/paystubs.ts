// Saving a paystub the owner reviewed: the figures they confirmed, and, when
// they choose, those figures applied to a pension (pension.ts) and to the
// monthly retirement contribution. Nothing is saved until the owner says so,
// and the file itself never is.

import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError, notFound } from '../../errors.js'
import { formatWholeCents } from '../../lib/money.js'
import { convertCadence } from '../../lib/periods.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { MAX_MONTHLY_CENTS } from '../retirement/assumptions.js'
import { PAY_CADENCES, type Pension } from '../retirement/pensions.js'
import { getSettings, mergeSettings, saveSettings } from '../settings.js'
import { applyToPension, newPaystubPensionSchema } from './pension.js'
import { MAX_EMPLOYER_LENGTH } from './redact.js'
import {
  CURRENT_FIELDS,
  MAX_PERIOD_CENTS,
  MAX_YEAR_CENTS,
  YEAR_TO_DATE_FIELDS,
  type CurrentField,
  type PayCadence,
  type YearToDateField,
} from './reading.js'

/** Paystubs kept: a year of weekly pay. Older ones are let go as new ones come in. */
export const MAX_PAYSTUBS = 52

/** One confirmed figure in cents up to `max`, or null when the paystub did not show it. */
const figureCents = (max: number) =>
  z
    .number()
    .int('Use whole cents')
    .min(0, 'A figure cannot be negative')
    .max(max, `Use ${formatWholeCents(max)} or less`)
    .nullable()

/**
 * An object with one figure for each field named, each up to `max`, every
 * one required so nothing is left out by mistake.
 */
function figuresSchema<F extends string>(fields: readonly F[], max: number) {
  const figure = figureCents(max)
  return z.object(
    Object.fromEntries(fields.map((field) => [field, figure])) as Record<F, typeof figure>,
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
    // A paycheck's figures share the review's limit, which a pension also takes.
    current: figuresSchema(CURRENT_FIELDS, MAX_PERIOD_CENTS),
    yearToDate: figuresSchema(YEAR_TO_DATE_FIELDS, MAX_YEAR_CENTS),
  })
  .refine(
    ({ current }) =>
      current.grossPay === null || current.netPay === null || current.netPay <= current.grossPay,
    { message: 'Take-home pay cannot be more than gross pay', path: ['current', 'netPay'] },
  )

export type Paystub = z.infer<typeof paystubSchema>

/** Saving a paystub, and where else its figures go. */
export const savePaystubSchema = z
  .object({
    paystub: paystubSchema,
    /** The pension to update with this paystub's pension figures; null leaves every pension as it is. */
    pensionAccountId: z.uuid().nullable().default(null),
    /** A pension to add as a new account with this paystub's pension figures, in the same step. */
    newPension: newPaystubPensionSchema.nullable().default(null),
    /** An account Leeway already has to become a pension with these figures, so it counts once. */
    attachAccountId: z.uuid().nullable().default(null),
    /** Whether the 401(k), 457 and 403(b) figures become the monthly retirement contribution. */
    setRetirementContribution: z.boolean().default(false),
  })
  // At most one place for the pension figures: a kept pension, a new account or an account Leeway has.
  .refine(
    ({ pensionAccountId, newPension, attachAccountId }) =>
      [pensionAccountId, newPension, attachAccountId].filter((target) => target !== null).length <=
      1,
    {
      message:
        'Choose one pension for these figures: one you keep, a new one, or an account you have.',
      path: ['newPension'],
    },
  )

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
  /** The pension as it now stands, when one was chosen or added. */
  pension: Pension | null
  /** The monthly retirement contribution now set, when it was. */
  retirementMonthlyContributionCents: number | null
}

/** The employee's own workplace plan contributions, which go into retirement savings. */
export const PLAN_FIELDS = ['plan401k', 'plan457', 'plan403b'] as const satisfies CurrentField[]

/** What one paycheck on this paystub put into a 401(k), 457 or 403(b), in all. */
export function planPerPaycheckCents(paystub: Paystub): number {
  return PLAN_FIELDS.reduce((sum, field) => sum + (paystub.current[field] ?? 0), 0)
}

/** The plan words for the one plan a paycheck pays into, as the owner knows it. */
const PLAN_NAMES: Record<(typeof PLAN_FIELDS)[number], string> = {
  plan401k: '401(k)',
  plan457: '457',
  plan403b: '403(b)',
}

/**
 * The plan this paystub pays into, named as it is ("401(k)", "457" or
 * "403(b)"), or "workplace plan" when it pays into more than one or none.
 */
export function planName(paystub: Paystub): string {
  const paid = PLAN_FIELDS.filter((field) => (paystub.current[field] ?? 0) > 0)
  return paid.length === 1 ? PLAN_NAMES[paid[0]!] : 'workplace plan'
}

/** What the paystub shows put into those plans so far this year, or null when it shows no such total. */
export function planYearToDateCents(paystub: Paystub): number | null {
  const shown = PLAN_FIELDS.map((field) => paystub.yearToDate[field]).filter(
    (cents) => cents !== null,
  )
  return shown.length === 0 ? null : shown.reduce((sum, cents) => sum + cents, 0)
}

/**
 * What a saved paystub shows going into a 401(k), 457 or 403(b) each month,
 * for the savings rate: null when it shows none, does not say how often pay
 * comes, or comes to more than Leeway takes as a contribution.
 */
export function planMonthlyCents(paystub: Paystub | null): number | null {
  if (!paystub || paystub.payCadence === null) return null
  const perPaycheck = planPerPaycheckCents(paystub)
  if (perPaycheck <= 0) return null
  const monthly = convertCadence(perPaycheck, paystub.payCadence, 'month')
  return monthly > MAX_MONTHLY_CENTS ? null : monthly
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
  const monthly = convertCadence(perPaycheck, paystub.payCadence, 'month')
  // The same limit the retirement settings hold a contribution to, said plainly here.
  if (monthly > MAX_MONTHLY_CENTS) {
    throw new AppError(
      'invalid_input',
      `The 401(k), 457 and 403(b) figures come to ${formatWholeCents(monthly)} a month, more than the ${formatWholeCents(MAX_MONTHLY_CENTS)} a month Leeway takes as a contribution. Check them against your paystub.`,
    )
  }
  return monthly
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
  const id = rows[0]!.id
  // Past the limit, the oldest paystubs go, but never the one just saved, even
  // when it has no pay date or is older than every other.
  await db.query(
    `DELETE FROM paystubs WHERE id <> $1 AND id NOT IN (
       SELECT id FROM paystubs WHERE id <> $1 ${NEWEST_FIRST} LIMIT $2)`,
    [id, MAX_PAYSTUBS - 1],
  )
  const saved = await db.query<PaystubRow>(`${SELECT_PAYSTUB} WHERE id = $1`, [id])
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
 * pension kept already or to a new one, and to the monthly retirement
 * contribution, all or nothing.
 */
export async function savePaystub(pool: pg.Pool, input: SavePaystub): Promise<PaystubSaved> {
  return withTransaction(pool, async (db) => {
    const { paystub } = input
    const contribution = input.setRetirementContribution ? monthlyPlanContribution(paystub) : null
    const pension = await applyToPension(db, paystub, input)
    if (contribution !== null) await setRetirementContribution(db, contribution)
    return {
      paystub: await insertPaystub(db, paystub, pension?.accountId ?? null),
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
