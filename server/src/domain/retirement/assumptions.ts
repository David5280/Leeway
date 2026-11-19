// The owner's retirement assumptions, kept in settings: when they were born,
// when they want to stop working, and the returns, inflation and withdrawal
// rate a projection uses. Every field has a plain error and a sensible
// default, except the birth year, which only the owner can give.

import { z } from 'zod'

/** A common, middle-of-the-road set: stop at 65, 6% returns, 2.5% inflation, the 4% rule. */
export const DEFAULT_RETIREMENT_AGE = 65
export const DEFAULT_RETURN_PERCENT = 6
export const DEFAULT_INFLATION_PERCENT = 2.5
export const DEFAULT_WITHDRAWAL_PERCENT = 4

/** The fields, without defaults, so a patch changes only what it names. */
export const retirementFields = {
  /** Null until the owner gives it; projections wait for it. */
  birthYear: z
    .number()
    .int('Use a four-digit year')
    .min(1900, 'Use a year after 1900')
    .max(2100, 'Use a four-digit year')
    .nullable(),
  retirementAge: z
    .number()
    .int('Use a whole age')
    .min(30, 'Use an age of 30 or more')
    .max(85, 'Use an age of 85 or less'),
  /** Yearly return before inflation, in percent. */
  returnPercent: z.number().min(-10, 'Use -10% or more').max(15, 'Use 15% or less'),
  inflationPercent: z.number().min(0, 'Use 0% or more').max(10, 'Use 10% or less'),
  /** The share of savings drawn each year in retirement. */
  withdrawalPercent: z.number().min(1, 'Use 1% or more').max(10, 'Use 10% or less'),
  /** Put into retirement savings each month. Null uses what Leeway found going in. */
  monthlyContributionCents: z
    .number()
    .int('Use whole cents')
    .min(0, 'A contribution cannot be negative')
    .nullable(),
  /** Income wanted in retirement, per month in today's dollars. Null uses recent spending. */
  targetMonthlyIncomeCents: z
    .number()
    .int('Use whole cents')
    .positive('A target must be more than zero')
    .nullable(),
}

export const retirementSchema = z.object({
  birthYear: retirementFields.birthYear.default(null),
  retirementAge: retirementFields.retirementAge.default(DEFAULT_RETIREMENT_AGE),
  returnPercent: retirementFields.returnPercent.default(DEFAULT_RETURN_PERCENT),
  inflationPercent: retirementFields.inflationPercent.default(DEFAULT_INFLATION_PERCENT),
  withdrawalPercent: retirementFields.withdrawalPercent.default(DEFAULT_WITHDRAWAL_PERCENT),
  monthlyContributionCents: retirementFields.monthlyContributionCents.default(null),
  targetMonthlyIncomeCents: retirementFields.targetMonthlyIncomeCents.default(null),
})

export type RetirementAssumptions = z.infer<typeof retirementSchema>

/** Any subset of the assumptions, for a change or a what-if. */
export const retirementPatchSchema = z.object(retirementFields).partial().strict()

export type RetirementPatch = z.infer<typeof retirementPatchSchema>
