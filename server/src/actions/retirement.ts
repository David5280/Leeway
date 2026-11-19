// Actions for pensions and retirement projections. A pension holds only the
// figures the owner gives, from their plan's statement or website; Leeway
// knows no plan's rules and never fills one in. Projections are rule-based
// and change nothing; the saved assumptions change through update_settings.

import { z } from 'zod'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { retirementView } from '../domain/profile/views.js'
import { retirementPatchSchema, retirementSchema } from '../domain/retirement/assumptions.js'
import {
  attachPension,
  attachPensionSchema,
  createPension,
  updatePension,
} from '../domain/retirement/pensionStore.js'
import { newPensionSchema, pensionPlanPatchSchema } from '../domain/retirement/pensions.js'
import { defineAction } from './action.js'
import { insightFormat } from './savings.js'
import { settingsAndToday } from './today.js'

/** The plan fields, explained once for every pension action. */
const PLAN_FIELDS =
  'A pension is a defined-benefit plan, such as Colorado PERA. Every plan field is optional and null until the owner gives it: contribution is what each paycheck pays in, {kind: "amount", cents} or {kind: "percent", percent} of grossPayCents; employerContributionPercent is what the employer adds, as a percent of gross pay; payCadence null follows the pay schedule Leeway found; serviceYears, salaryBasisMonthlyCents (the monthly salary the plan\'s formula uses) and multiplierPercent (per year of service) give a benefit by the formula salary x multiplier x years; statementBenefitMonthlyCents is the monthly benefit from the plan\'s statement, which wins over the formula; benefitAge null means the planned retirement age; checkedOn is when the owner last checked the figures. Enter only figures the owner gives you: never supply a multiplier, rate or rule from what you know of a plan. Amounts are in cents.'

export const createPensionAction = defineAction({
  name: 'create_pension',
  title: 'Add a pension',
  description: `Records a pension as a new account of kind "pension", with its name, its member balance (balanceCents, null when not known) and any plan figures. When the pension is already an account in Leeway, such as one linked from the bank, use attach_pension instead, so it is not counted twice. ${PLAN_FIELDS} To remove one, use delete_account.`,
  input: newPensionSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) => {
    const { settings } = await settingsAndToday(ctx)
    return createPension(ctx.db, input, settings.currency)
  },
})

export const attachPensionAction = defineAction({
  name: 'attach_pension',
  title: 'Record a pension on an existing account',
  description: `Records a pension's plan on an account Leeway already has (accountId), such as a pension linked from the bank or one listed under retirement or investing, instead of adding a second account. The account becomes a pension, and its balance is then what pays the benefit, not savings. The plan given replaces any already there. ${PLAN_FIELDS}`,
  input: attachPensionSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) => attachPension(ctx.db, input),
})

export const updatePensionAction = defineAction({
  name: 'update_pension',
  title: 'Update a pension',
  description: `Changes the plan figures of a pension, the account given by accountId. Only the fields given change; null clears one. An account the owner marked as a pension may be given figures this way too. ${PLAN_FIELDS}`,
  input: pensionPlanPatchSchema.extend({ accountId: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { accountId, ...patch }) => updatePension(ctx.db, accountId, patch),
})

/** What project_retirement returns, one part per line. Joined into one description below. */
const PROJECT_RETIREMENT_PARTS = [
  "What pensions and savings could pay in retirement, in today's dollars, worked out by rule with no AI.",
  'Optional fields override the saved assumptions for this call only, as a what-if; nothing is saved (update_settings with retirement saves them): birthYear, retirementAge, returnPercent (yearly, before inflation), inflationPercent, withdrawalPercent, monthlyContributionCents and targetMonthlyIncomeCents (null uses recent spending).',
  'lens is the retirement question, answer and meters in words. plan.projection is null until a birth year is known.',
  'Savings to draw on are the retirement and investment accounts plus cash beyond the emergency fund target (startingSavings), grown in a low, middle and high case with returns 2 points either side. Income is pension benefits started by the retirement age plus savings at the withdrawal rate.',
  "Each pension's benefit comes from the plan's statement, or from the formula with the salary, multiplier and service the owner entered: low counts the service so far, middle and high the service by the benefit age. No plan rules, such as caps or early retirement reductions, are applied.",
  "atAge is the age projected: the retirement age, or the owner's age once past it. A pension that starts after atAge is not in the income; laterPensionAge says when it starts.",
  'coverage and onTrack are null without a target, while a pension has no known benefit or starts after atAge, and whenever a pension is recorded unless the middle case meets the target: Leeway never says a pension holder falls short. laterAge is a later age, above the current one, that would meet the target, offered as a choice.',
  'A pension is retirement saving: when plan.hasPension, never call little or nothing going into a 401(k), IRA or brokerage account under-saving. Always share plan.note with the numbers, and give ranges, never a single promise. Read-only.',
]

export const projectRetirementAction = defineAction({
  name: 'project_retirement',
  title: 'Project retirement',
  description: PROJECT_RETIREMENT_PARTS.join(' '),
  input: retirementPatchSchema,
  scope: 'read',
  surface: 'all',
  run: async (ctx, whatIf) => {
    const { settings, today } = await settingsAndToday(ctx)
    const assumptions = retirementSchema.parse({ ...settings.retirement, ...whatIf })
    const tried = { ...settings, retirement: assumptions }
    const profile = await getFinancialProfile(ctx.db, tried, today)
    return {
      asOf: today,
      whatIf: Object.keys(whatIf).length > 0,
      ...retirementView(profile, insightFormat(settings)),
    }
  },
})
