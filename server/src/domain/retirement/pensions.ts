// Defined-benefit pensions, such as Colorado PERA. A pension is an account of
// kind "pension" (accountKinds.ts) with plan details the owner gives: what
// they pay in, what the employer adds, their service, and the benefit from the
// plan's statement or from the plan's formula with the multiplier they typed.
// A bank never shows a pension's benefit, and plan rules differ and change,
// so nothing here is guessed: a field left empty stays empty and is said to be
// unknown, and no plan's rules are built in.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import { isoDateSchema, patchOf } from '../../lib/schemas.js'
import { getAccount, insertManualAccount, type Account } from '../accounts.js'
import type { Band } from './projection.js'

/** How often a paycheck comes, for turning a per-paycheck amount into a monthly one. */
export const PAY_CADENCES = ['week', 'biweek', 'semimonth', 'month'] as const

/** One owner rarely has more than a couple; this only stops a runaway caller. */
export const MAX_PENSIONS = 10

const cents = (what: string) =>
  z.number().int(`Enter ${what} in whole cents`).min(0, `${what} cannot be negative`)

const percent = z.number().min(0, 'Use 0% or more').max(100, 'Use 100% or less')

/** What the owner pays in each paycheck: a fixed amount, or a percent of gross pay. */
export const pensionContributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), cents: cents('The contribution').max(10_000_000) }),
  z.object({ kind: z.literal('percent'), percent }),
])

export type PensionContribution = z.infer<typeof pensionContributionSchema>

/** The plan details, every one optional: null until the owner gives it. */
export const pensionPlanSchema = z.object({
  /** What each paycheck pays in. */
  contribution: pensionContributionSchema.nullable().default(null),
  /** What the employer pays in on top, as a percent of gross pay. */
  employerContributionPercent: percent.nullable().default(null),
  /** Gross pay per paycheck, which turns a percent into an amount. */
  grossPayCents: z
    .number()
    .int('Use whole cents')
    .positive('Gross pay must be more than zero')
    .nullable()
    .default(null),
  /** Null follows the pay schedule Leeway found. */
  payCadence: z.enum(PAY_CADENCES).nullable().default(null),
  /** Years of service so far, as the plan's statement gives them. */
  serviceYears: z
    .number()
    .min(0, 'Years of service cannot be negative')
    .max(60, 'Use 60 years or fewer')
    .nullable()
    .default(null),
  /** The monthly salary the plan's formula uses, such as a highest average salary. */
  salaryBasisMonthlyCents: z
    .number()
    .int('Use whole cents')
    .positive('The salary must be more than zero')
    .nullable()
    .default(null),
  /** The plan's multiplier per year of service, in percent, as the owner typed it. */
  multiplierPercent: z
    .number()
    .min(0.01, 'Use 0.01% or more')
    .max(10, 'Use 10% or less')
    .nullable()
    .default(null),
  /** The monthly benefit the plan's statement or calculator gives, in today's dollars. */
  statementBenefitMonthlyCents: cents('The benefit').nullable().default(null),
  /** The age the benefit starts; null means the owner's planned retirement age. */
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

export type PensionPlan = z.infer<typeof pensionPlanSchema>

/** A change to some plan details; only the fields given change. */
export const pensionPlanPatchSchema = patchOf(pensionPlanSchema)

export type PensionPlanPatch = z.infer<typeof pensionPlanPatchSchema>

/** A plan with nothing entered yet, as a pension account starts out. */
export const EMPTY_PLAN: PensionPlan = pensionPlanSchema.parse({})

/** Adding a pension: its name, the member balance if the owner knows it, and its plan. */
export const newPensionSchema = pensionPlanSchema.extend({
  name: z.string().trim().min(1, 'Name the plan, like Colorado PERA').max(80),
  /** The member account's balance from the plan's statement; null when not known. */
  balanceCents: cents('The balance').nullable().default(null),
})

export type NewPension = z.infer<typeof newPensionSchema>

/** A pension: its account, and the plan details the owner gave. */
export interface Pension {
  accountId: string
  name: string
  /** The member account's balance, or null when not known. */
  balanceCents: number | null
  plan: PensionPlan
}

/** What a pension takes from pay, and what the employer adds, when Leeway knows enough. */
export interface PensionPayIn {
  perPaycheckCents: number | null
  monthlyCents: number | null
  employerMonthlyCents: number | null
}

/** A share of gross pay per paycheck in cents, or null without gross pay. */
function shareOfPay(plan: PensionPlan, percentOfPay: number): number | null {
  return plan.grossPayCents === null ? null : Math.round((plan.grossPayCents * percentOfPay) / 100)
}

/**
 * What a pension takes from each paycheck and from a month of pay, and what
 * the employer adds a month. A percent needs gross pay; a monthly figure needs
 * the pay cadence, the plan's own or else the one Leeway found. Unknown parts
 * are null, never zero.
 */
export function pensionPayIn(plan: PensionPlan, foundCadence: Cadence | null): PensionPayIn {
  const { contribution, employerContributionPercent } = plan
  let perPaycheckCents: number | null = null
  if (contribution?.kind === 'amount') perPaycheckCents = contribution.cents
  if (contribution?.kind === 'percent') perPaycheckCents = shareOfPay(plan, contribution.percent)

  const cadence = plan.payCadence ?? foundCadence
  const monthly = (perPaycheck: number | null) =>
    perPaycheck !== null && cadence ? convertCadence(perPaycheck, cadence, 'month') : null
  const employerPerPaycheck =
    employerContributionPercent === null ? null : shareOfPay(plan, employerContributionPercent)
  return {
    perPaycheckCents,
    monthlyCents: monthly(perPaycheckCents),
    employerMonthlyCents: monthly(employerPerPaycheck),
  }
}

/** What all the pensions take from pay a month, and what employers add, counting only what is known. */
export interface PensionMonthlyTotals {
  /** Null when no pension's monthly contribution can be worked out. */
  memberCents: number | null
  employerCents: number | null
}

/** Adds up the known monthly figures; a figure no pension has stays null, never zero. */
export function pensionMonthlyTotals(
  pensions: Pension[],
  foundCadence: Cadence | null,
): PensionMonthlyTotals {
  const payIns = pensions.map((pension) => pensionPayIn(pension.plan, foundCadence))
  const total = (values: (number | null)[]) => {
    const known = values.filter((value) => value !== null)
    return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
  }
  return {
    memberCents: total(payIns.map((payIn) => payIn.monthlyCents)),
    employerCents: total(payIns.map((payIn) => payIn.employerMonthlyCents)),
  }
}

/** Said beside a benefit worked out from the formula, wherever it is shown. */
export const FORMULA_NOTE =
  "Worked out from the salary, multiplier and service you entered. The plan's own rules, such as a reduction for starting early, can change it; the plan's statement gives the exact figure."

/** Where a benefit figure came from: the plan's own statement, or its formula with the owner's numbers. */
export type BenefitSource = 'statement' | 'formula'

/** A monthly benefit in today's dollars, as a range, with where it came from. */
export interface PensionBenefit extends Band {
  source: BenefitSource
}

/** salary x multiplier x years, the usual shape of a defined-benefit formula. */
function formulaBenefit(salaryCents: number, multiplierPercent: number, years: number): number {
  return Math.round((salaryCents * multiplierPercent * years) / 100)
}

/**
 * The monthly benefit, or null while the owner has given neither a statement
 * figure nor every number the formula needs.
 *
 * A statement figure is the plan's own, so it is the same in every case. The
 * formula uses the salary and multiplier the owner typed: the low case counts
 * the service so far, as if they left today, and the others count the
 * service they would have by the time the benefit starts, if they stay. No
 * plan rules are added: no caps, early retirement reductions or
 * cost-of-living increases, which the plan's statement would include.
 * `yearsToBenefit` is null without a birth year, and then only the service so
 * far is counted.
 */
export function pensionBenefit(
  plan: PensionPlan,
  yearsToBenefit: number | null,
): PensionBenefit | null {
  const statement = plan.statementBenefitMonthlyCents
  if (statement !== null) {
    return { low: statement, mid: statement, high: statement, source: 'statement' }
  }
  const { salaryBasisMonthlyCents: salary, multiplierPercent, serviceYears } = plan
  if (salary === null || multiplierPercent === null || serviceYears === null) return null
  const soFar = formulaBenefit(salary, multiplierPercent, serviceYears)
  const staying = formulaBenefit(
    salary,
    multiplierPercent,
    serviceYears + Math.max(0, yearsToBenefit ?? 0),
  )
  return { low: soFar, mid: staying, high: staying, source: 'formula' }
}

interface PlanRow {
  accountId: string
  contributionCents: number | null
  contributionBps: number | null
  employerContributionBps: number | null
  grossPayCents: number | null
  payCadence: PensionPlan['payCadence']
  serviceYears: number | null
  salaryBasisCents: number | null
  multiplierBps: number | null
  statementBenefitCents: number | null
  benefitAge: number | null
  checkedOn: string | null
}

/** Percents are stored in basis points, which keep a figure like 10.5% or 2.25% exact. */
const toBps = (value: number | null) => (value === null ? null : Math.round(value * 100))
const fromBps = (value: number | null) => (value === null ? null : value / 100)

function planFromRow(row: PlanRow): PensionPlan {
  let contribution: PensionContribution | null = null
  if (row.contributionCents !== null) {
    contribution = { kind: 'amount', cents: row.contributionCents }
  } else if (row.contributionBps !== null) {
    contribution = { kind: 'percent', percent: row.contributionBps / 100 }
  }
  return {
    contribution,
    employerContributionPercent: fromBps(row.employerContributionBps),
    grossPayCents: row.grossPayCents,
    payCadence: row.payCadence,
    serviceYears: row.serviceYears,
    salaryBasisMonthlyCents: row.salaryBasisCents,
    multiplierPercent: fromBps(row.multiplierBps),
    statementBenefitMonthlyCents: row.statementBenefitCents,
    benefitAge: row.benefitAge,
    checkedOn: row.checkedOn,
  }
}

/** The stored plan of each of these accounts that has one, by account id. */
async function plansOf(db: Db, accountIds: string[]): Promise<Map<string, PensionPlan>> {
  if (accountIds.length === 0) return new Map()
  const { rows } = await db.query<PlanRow>(
    `SELECT account_id AS "accountId", contribution_cents AS "contributionCents",
       contribution_bps AS "contributionBps", employer_contribution_bps AS "employerContributionBps",
       gross_pay_cents AS "grossPayCents", pay_cadence AS "payCadence",
       service_years::float8 AS "serviceYears", salary_basis_cents AS "salaryBasisCents",
       multiplier_bps AS "multiplierBps", statement_benefit_cents AS "statementBenefitCents",
       benefit_age AS "benefitAge", checked_on AS "checkedOn"
     FROM pension_plans WHERE account_id = ANY($1::uuid[])`,
    [accountIds],
  )
  return new Map(rows.map((row) => [row.accountId, planFromRow(row)]))
}

function pensionOf(account: Account, plan: PensionPlan | undefined): Pension {
  return {
    accountId: account.id,
    name: account.name,
    balanceCents: account.balanceCents,
    plan: plan ?? EMPTY_PLAN,
  }
}

/**
 * The pensions among these accounts, as listAccounts gives them, each with
 * its plan. An account marked as a pension with no plan entered yet gets an
 * empty one, so it still shows, asking for its details.
 */
export async function pensionsOf(db: Db, accounts: Account[]): Promise<Pension[]> {
  const pensionAccounts = accounts.filter((account) => account.kind === 'pension')
  const plans = await plansOf(
    db,
    pensionAccounts.map((account) => account.id),
  )
  return pensionAccounts.map((account) => pensionOf(account, plans.get(account.id)))
}

/** Writes a pension's whole plan, adding the row the first time. */
async function savePlan(db: Db, accountId: string, plan: PensionPlan): Promise<void> {
  const { contribution } = plan
  await db.query(
    `INSERT INTO pension_plans (account_id, contribution_cents, contribution_bps,
       employer_contribution_bps, gross_pay_cents, pay_cadence, service_years, salary_basis_cents,
       multiplier_bps, statement_benefit_cents, benefit_age, checked_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (account_id) DO UPDATE SET
       contribution_cents = EXCLUDED.contribution_cents,
       contribution_bps = EXCLUDED.contribution_bps,
       employer_contribution_bps = EXCLUDED.employer_contribution_bps,
       gross_pay_cents = EXCLUDED.gross_pay_cents, pay_cadence = EXCLUDED.pay_cadence,
       service_years = EXCLUDED.service_years, salary_basis_cents = EXCLUDED.salary_basis_cents,
       multiplier_bps = EXCLUDED.multiplier_bps,
       statement_benefit_cents = EXCLUDED.statement_benefit_cents,
       benefit_age = EXCLUDED.benefit_age, checked_on = EXCLUDED.checked_on, updated_at = now()`,
    [
      accountId,
      contribution?.kind === 'amount' ? contribution.cents : null,
      contribution?.kind === 'percent' ? toBps(contribution.percent) : null,
      toBps(plan.employerContributionPercent),
      plan.grossPayCents,
      plan.payCadence,
      plan.serviceYears,
      plan.salaryBasisMonthlyCents,
      toBps(plan.multiplierPercent),
      plan.statementBenefitMonthlyCents,
      plan.benefitAge,
      plan.checkedOn,
    ],
  )
}

/** The pension on one account, or an error when the account is not a pension. */
async function getPension(db: Db, accountId: string): Promise<Pension> {
  const account = await getAccount(db, accountId)
  if (account.kind !== 'pension') {
    throw new AppError(
      'invalid_input',
      'This account is not a pension. Mark it as one first, or add a pension.',
    )
  }
  return pensionOf(account, (await plansOf(db, [accountId])).get(accountId))
}

/**
 * Adds a pension: an account added by hand, of kind pension, with its plan.
 * It is an investment-type account, the type banks give a pension, so its
 * balance, when known, counts as something the owner owns.
 */
export async function createPension(db: Db, input: NewPension, currency: string): Promise<Pension> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM accounts WHERE kind = 'pension'`,
  )
  if (rows[0]!.count >= MAX_PENSIONS) {
    throw new AppError('invalid_input', `Leeway keeps up to ${MAX_PENSIONS} pensions`)
  }
  const { name, balanceCents, ...plan } = input
  const account = await insertManualAccount(db, {
    name,
    type: 'investment',
    subtype: 'pension',
    balanceCents,
    creditLimitCents: null,
    currency,
    kind: 'pension',
  })
  await savePlan(db, account.id, plan)
  return getPension(db, account.id)
}

/** Changes some of a pension's plan details; the rest stay as they are. */
export async function updatePension(
  db: Db,
  accountId: string,
  patch: PensionPlanPatch,
): Promise<Pension> {
  const current = await getPension(db, accountId)
  await savePlan(db, accountId, { ...current.plan, ...patch })
  return getPension(db, accountId)
}
