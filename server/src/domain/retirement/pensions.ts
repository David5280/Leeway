// Defined-benefit pensions, such as Colorado PERA. A pension is an account of
// kind "pension" (accountKinds.ts) with plan details the owner gives: what
// they pay in, what the employer adds, their service, and the benefit from the
// plan's statement or from the plan's formula with the multiplier they typed.
// A bank never shows a pension's benefit, and plan rules differ and change,
// so nothing here is guessed: a field left empty stays empty and is said to be
// unknown, and no plan's rules are built in. This module holds the plan's
// shape and its arithmetic, and is pure; pensionStore.ts keeps plans in the
// database.

import { z } from 'zod'
import { formatWholeCents } from '../../lib/money.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import { isoDateSchema, patchOf } from '../../lib/schemas.js'
import { MAX_MONTHLY_CENTS } from './assumptions.js'
import type { Band } from './projection.js'

/** How often a paycheck comes, for turning a per-paycheck amount into a monthly one. */
export const PAY_CADENCES = ['week', 'biweek', 'semimonth', 'month'] as const

/** One owner rarely has more than a couple; this only stops a runaway caller. */
export const MAX_PENSIONS = 10

/** The most a member balance may be: $50,000,000, far above any real pension account. */
export const MAX_BALANCE_CENTS = 5_000_000_000

/** Whole cents from zero up to `max`, saying the limit in dollars when it is crossed. */
const cents = (what: string, max: number) =>
  z
    .number()
    .int(`Enter ${what} in whole cents`)
    .min(0, `${what} cannot be negative`)
    .max(max, `${what} can be up to ${formatWholeCents(max)}`)

/** A per-paycheck or monthly figure: a paycheck, a salary or a benefit. */
const monthlyCents = (what: string) => cents(what, MAX_MONTHLY_CENTS)

const percent = z.number().min(0, 'Use 0% or more').max(100, 'Use 100% or less')

/** What the owner pays in each paycheck: a fixed amount, or a percent of gross pay. */
export const pensionContributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), cents: monthlyCents('The contribution') }),
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
  grossPayCents: monthlyCents('Gross pay')
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
  salaryBasisMonthlyCents: monthlyCents('The salary')
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
  statementBenefitMonthlyCents: monthlyCents('The benefit').nullable().default(null),
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
  balanceCents: cents('The balance', MAX_BALANCE_CENTS).nullable().default(null),
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
