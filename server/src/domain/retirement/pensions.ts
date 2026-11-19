// Defined-benefit pensions the owner enters by hand, such as Colorado PERA:
// what they pay in each paycheck, their years of service and the monthly
// benefit they expect. A bank never shows a pension, so nothing here is
// guessed; a field left empty stays empty and is said to be unknown.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { AppError, notFound } from '../../errors.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import { isoDateSchema, patchOf } from '../../lib/schemas.js'

/** How often a paycheck comes, for turning a per-paycheck amount into a monthly one. */
export const PAY_CADENCES = ['week', 'biweek', 'semimonth', 'month'] as const
export type PayCadence = (typeof PAY_CADENCES)[number]

/** One owner rarely has more than a couple; this only stops a runaway caller. */
export const MAX_PENSIONS = 10

const cents = (what: string) =>
  z.number().int(`Enter ${what} in whole cents`).min(0, `${what} cannot be negative`)

/** What the owner pays in each paycheck: a fixed amount, or a percent of gross pay. */
export const pensionContributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), cents: cents('The contribution').max(10_000_000) }),
  z.object({
    kind: z.literal('percent'),
    percent: z.number().min(0, 'Use 0% or more').max(100, 'Use 100% or less'),
  }),
])

export type PensionContribution = z.infer<typeof pensionContributionSchema>

export const pensionInputSchema = z.object({
  planName: z.string().trim().min(1, 'Name the plan, like Colorado PERA').max(80),
  /** Null while the owner has not entered it (or imported a paystub) yet. */
  contribution: pensionContributionSchema.nullable().default(null),
  /** Gross pay per paycheck, which turns a percent contribution into an amount. */
  grossPayCents: z
    .number()
    .int()
    .positive('Gross pay must be more than zero')
    .nullable()
    .default(null),
  /** Null follows the pay schedule Leeway found. */
  payCadence: z.enum(PAY_CADENCES).nullable().default(null),
  serviceYears: z
    .number()
    .min(0, 'Years of service cannot be negative')
    .max(60, 'Use 60 years or fewer')
    .nullable()
    .default(null),
  /** The expected monthly benefit, in today's dollars. */
  monthlyBenefitCents: cents('The benefit').nullable().default(null),
  /** Where the benefit came from: the plan's statement, or an estimate. */
  benefitSource: z.enum(['statement', 'estimate']).nullable().default(null),
  /** The age the benefit starts; null means the owner's retirement age. */
  benefitAge: z
    .number()
    .int('Use a whole age')
    .min(40, 'Use an age of 40 or more')
    .max(85, 'Use an age of 85 or less')
    .nullable()
    .default(null),
  /** When the owner last checked these figures against the plan. */
  checkedOn: isoDateSchema.nullable().default(null),
})

export const pensionPatchSchema = patchOf(pensionInputSchema)

export type PensionInput = z.infer<typeof pensionInputSchema>

export interface Pension extends PensionInput {
  id: string
}

/** A pension's contribution as money, when Leeway knows enough to say. */
export interface PensionPayIn {
  perPaycheckCents: number | null
  monthlyCents: number | null
}

/**
 * What a pension takes from each paycheck and from a month of pay. A percent
 * needs gross pay; a monthly figure needs the pay cadence, the pension's own
 * or else the one Leeway found. Unknown parts are null, never zero.
 */
export function pensionPayIn(pension: Pension, foundCadence: Cadence | null): PensionPayIn {
  const { contribution } = pension
  let perPaycheckCents: number | null = null
  if (contribution?.kind === 'amount') perPaycheckCents = contribution.cents
  else if (contribution?.kind === 'percent' && pension.grossPayCents !== null) {
    perPaycheckCents = Math.round((pension.grossPayCents * contribution.percent) / 100)
  }
  const cadence = pension.payCadence ?? foundCadence
  const monthlyCents =
    perPaycheckCents !== null && cadence ? convertCadence(perPaycheckCents, cadence, 'month') : null
  return { perPaycheckCents, monthlyCents }
}

interface PensionRow extends Omit<Pension, 'contribution'> {
  contributionCents: number | null
  contributionBps: number | null
}

function fromRow({ contributionCents, contributionBps, ...row }: PensionRow): Pension {
  let contribution: PensionContribution | null = null
  if (contributionCents !== null) contribution = { kind: 'amount', cents: contributionCents }
  else if (contributionBps !== null)
    contribution = { kind: 'percent', percent: contributionBps / 100 }
  return { ...row, contribution }
}

/** The contribution as the two columns that store it. */
function contributionColumns(contribution: PensionContribution | null) {
  return {
    cents: contribution?.kind === 'amount' ? contribution.cents : null,
    // Basis points keep a percent like 10.5% exact.
    bps: contribution?.kind === 'percent' ? Math.round(contribution.percent * 100) : null,
  }
}

const SELECT = `
  SELECT id, plan_name AS "planName", contribution_cents AS "contributionCents",
    contribution_bps AS "contributionBps", gross_pay_cents AS "grossPayCents",
    pay_cadence AS "payCadence", service_years::float8 AS "serviceYears",
    monthly_benefit_cents AS "monthlyBenefitCents", benefit_source AS "benefitSource",
    benefit_age AS "benefitAge", checked_on AS "checkedOn"
  FROM pensions`

export async function listPensions(db: Db): Promise<Pension[]> {
  const { rows } = await db.query<PensionRow>(`${SELECT} ORDER BY created_at, id`)
  return rows.map(fromRow)
}

async function getPension(db: Db, id: string): Promise<Pension> {
  const { rows } = await db.query<PensionRow>(`${SELECT} WHERE id = $1`, [id])
  if (!rows[0]) throw notFound('Pension')
  return fromRow(rows[0])
}

/** Writes every field of a pension; one statement for both insert and update. */
async function save(db: Db, pension: PensionInput, id: string | null): Promise<string> {
  const contribution = contributionColumns(pension.contribution)
  const values = [
    pension.planName,
    contribution.cents,
    contribution.bps,
    pension.grossPayCents,
    pension.payCadence,
    pension.serviceYears,
    pension.monthlyBenefitCents,
    pension.benefitSource,
    pension.benefitAge,
    pension.checkedOn,
  ]
  const columns = `plan_name, contribution_cents, contribution_bps, gross_pay_cents, pay_cadence,
    service_years, monthly_benefit_cents, benefit_source, benefit_age, checked_on`
  if (id === null) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO pensions (${columns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      values,
    )
    return rows[0]!.id
  }
  await db.query(
    `UPDATE pensions SET (${columns}) = ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) WHERE id = $11`,
    [...values, id],
  )
  return id
}

export async function createPension(db: Db, input: PensionInput): Promise<Pension> {
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM pensions')
  if (rows[0]!.count >= MAX_PENSIONS) {
    throw new AppError('invalid_input', `Leeway keeps up to ${MAX_PENSIONS} pensions`)
  }
  return getPension(db, await save(db, input, null))
}

export async function updatePension(
  db: Db,
  id: string,
  patch: z.infer<typeof pensionPatchSchema>,
): Promise<Pension> {
  const current = await getPension(db, id)
  return getPension(db, await save(db, { ...current, ...patch }, id))
}

export async function deletePension(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM pensions WHERE id = $1', [id])
  if (!rowCount) throw notFound('Pension')
}
