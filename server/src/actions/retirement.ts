// Actions for pensions and retirement projections. Pensions are entered by
// the owner in the app; assistants can read them and run what-if projections,
// which change nothing.

import { z } from 'zod'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { retirementPatchSchema, retirementSchema } from '../domain/retirement/assumptions.js'
import {
  estimateMonthlyBenefit,
  PERA_MEMBER_RATES,
  PERA_MULTIPLIER_PERCENT,
  PERA_RATE_LABEL,
} from '../domain/retirement/pera.js'
import {
  createPension,
  deletePension,
  pensionInputSchema,
  pensionPatchSchema,
  updatePension,
} from '../domain/retirement/pensions.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const PENSIONS_EXPLAINED =
  'A pension here is a defined-benefit plan such as Colorado PERA, entered by the owner. contribution is what each paycheck pays in: {kind: "amount", cents} or {kind: "percent", percent} of grossPayCents, or null while it is not set yet. payCadence null follows the pay schedule Leeway found. monthlyBenefitCents is the expected benefit in today\'s dollars, from the plan\'s statement or an estimate (benefitSource), starting at benefitAge (null means the retirement age). Amounts are in cents.'

export const listPensionsAction = defineAction({
  name: 'list_pensions',
  title: 'List pensions',
  description: `The owner's pensions, each with payIn: its contribution per paycheck and per month (null where Leeway lacks gross pay or the pay schedule), and counted: whether its benefit counts in retirement income. Also PERA's published member rates by division, for reference only. A pension is retirement saving: never call the owner under-saving for not putting money in an IRA, 401(k) or brokerage when one is recorded. ${PENSIONS_EXPLAINED} Read-only.`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    const profile = await getFinancialProfile(ctx.db, settings, today)
    return {
      pensions: profile.retirement.pensions,
      peraRates: { label: PERA_RATE_LABEL, divisions: PERA_MEMBER_RATES },
    }
  },
})

export const createPensionAction = defineAction({
  name: 'create_pension',
  title: 'Add a pension',
  description: `Record a pension. ${PENSIONS_EXPLAINED}`,
  input: pensionInputSchema,
  scope: 'write',
  surface: 'app',
  run: async (ctx, input) => createPension(ctx.db, input),
})

export const updatePensionAction = defineAction({
  name: 'update_pension',
  title: 'Update a pension',
  description: `Change a pension. Only the fields given change. ${PENSIONS_EXPLAINED}`,
  input: pensionPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id, ...patch }) => updatePension(ctx.db, id, patch),
})

export const deletePensionAction = defineAction({
  name: 'delete_pension',
  title: 'Delete a pension',
  description: 'Stop tracking a pension.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await deletePension(ctx.db, id)
    return { deleted: id }
  },
})

export const estimatePensionAction = defineAction({
  name: 'estimate_pension',
  title: 'Estimate a pension benefit',
  description: `A rough monthly benefit from PERA's formula: highest average monthly salary x ${PERA_MULTIPLIER_PERCENT}% (multiplierPercent) x years of service at the start of the benefit. It leaves out early retirement reductions and survivor options, so it is an estimate to check against the plan's statement. Amounts are in cents. Read-only.`,
  input: z.object({
    monthlySalaryCents: z.number().int('Use whole cents').positive('Salary must be more than zero'),
    serviceYears: z.number().min(0, 'Years cannot be negative').max(60, 'Use 60 years or fewer'),
    multiplierPercent: z.number().min(0.1).max(5).default(PERA_MULTIPLIER_PERCENT),
  }),
  scope: 'read',
  surface: 'all',
  run: async (_ctx, input) => ({
    monthlyBenefitCents: estimateMonthlyBenefit(input),
    label: 'Estimate, not a statement from the plan',
  }),
})

export const projectRetirementAction = defineAction({
  name: 'project_retirement',
  title: 'Project retirement',
  description: `Whether savings and pensions can pay for the retirement the owner wants, in today's dollars. Optional fields override the saved assumptions for this call only (a what-if, nothing is saved): birthYear, retirementAge, returnPercent (yearly, before inflation), inflationPercent, withdrawalPercent, monthlyContributionCents, targetMonthlyIncomeCents. projection is null until a birth year is known. Savings are the retirement accounts, grown in a low, middle and high case (returns 2 points either side); income is pensions counted plus savings at the withdrawal rate; coverage is income as a percent of the target, and onTrack is null without a target or while a pension has no benefit entered. laterAge is a later retirement age that would meet the target, offered as a choice. Contributions to an IRA, 401(k) or brokerage are optional when a pension is recorded (hasPension): never call that under-saving. Always share the note with the numbers. Read-only.`,
  input: retirementPatchSchema,
  scope: 'read',
  surface: 'all',
  run: async (ctx, whatIf) => {
    const { settings, today } = await settingsAndToday(ctx)
    const assumptions = retirementSchema.parse({ ...settings.retirement, ...whatIf })
    const profile = await getFinancialProfile(
      ctx.db,
      { ...settings, retirement: assumptions },
      today,
    )
    return {
      asOf: today,
      whatIf: Object.keys(whatIf).length > 0,
      ...profile.retirement,
    }
  },
})
