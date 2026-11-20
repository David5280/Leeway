// Actions for coaching: a full check-in in one call, and "can I afford this?".

import { z } from 'zod'
import { affordability } from '../domain/afford.js'
import { budgetSummary, recentSurplus } from '../domain/budgetReport.js'
import { getCashFlow } from '../domain/cashFlow.js'
import { getCheckin } from '../domain/checkin.js'
import { listGoals } from '../domain/goals.js'
import { planPurchase } from '../domain/purchasePlan.js'
import { periodConfig, type Settings } from '../domain/settings.js'
import type { AppContext } from '../context.js'
import { formatCents } from '../lib/money.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const purchaseInput = z.object({
  amountCents: z.number().int().positive(),
  categoryId: z.uuid().nullable().default(null),
})

/** Today's check of a purchase: the shared first step of both questions. */
async function checkToday(
  ctx: AppContext,
  settings: Settings,
  today: string,
  { amountCents, categoryId }: z.output<typeof purchaseInput>,
) {
  const [cashFlow, budget] = await Promise.all([
    getCashFlow(ctx.db, settings, today),
    budgetSummary(ctx.db, settings, ctx.now()),
  ])
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  return affordability(amountCents, cashFlow, budget, categoryId, money)
}

export const getCheckinAction = defineAction({
  name: 'get_checkin',
  title: 'Money check-in',
  description:
    'Everything a coach needs in one call: the attention list (priority now, soon or fyi, each with a plain message and the tool that shows more), this budget period, cash until payday, bills, goals, debts (avalanche plan with no extra payment), the net worth change over 30 days and a savings glance (total saved and invested, its change this month, emergency fund months, bankSeenSavingsRatePercent, payrollIncludedSavingsRatePercent and pension, or null with neither savings accounts nor a pension). bankSeenSavingsRatePercent counts only money moved through the bank, never payroll deductions such as a pension or a 401(k), so never say it is too little. payrollIncludedSavingsRatePercent adds the payroll deductions Leeway knows (pension contributions the owner entered, and the 401(k), 457 or 403(b) a paystub from the last six months shows), and is null without any. pension (null without one) gives how many are recorded and, where known, what the owner and the employer pay in a month. A pension is retirement saving: never call someone with one under-saving for retirement for putting little or nothing in a 401(k), IRA or brokerage account. Start any check-in or open question about money here. Amounts are in cents.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return getCheckin(ctx.db, settings, ctx.now(), today)
  },
})

export const canIAffordAction = defineAction({
  name: 'can_i_afford',
  title: 'Can I afford this?',
  description:
    'Checks a purchase made today against cash until payday (after the bills due before it), the budget, and what goals set aside from the budget hold back. verdict is "yes", "tight" (fits, but pushes a budget over, dips into money held for goals, or halves the money left per day) or "no" (the bills before payday would not be covered). Give categoryId to check that category\'s budget too. reasons explain the verdict in plain words. For "when could I afford it?", use when_can_i_afford. Nothing is bought or recorded.',
  input: purchaseInput,
  scope: 'read',
  surface: 'all',
  run: async (ctx, input) => {
    const { settings, today } = await settingsAndToday(ctx)
    return checkToday(ctx, settings, today, input)
  },
})

export const whenCanIAffordAction = defineAction({
  name: 'when_can_i_afford',
  title: 'When can I afford this?',
  description:
    'When a purchase becomes affordable. If it fits today (as can_i_afford checks), affordableBy is today. Otherwise it counts budget periods of saving: at perPeriodCents if given (what the owner says they can put aside each period), or else the recent surplus (income minus spending, averaged over the last 3 full periods) after what goals in progress need each period. savedCents is what is already put aside toward it. Returns periodsNeeded, affordableBy (the last day of the period it is saved by), the figures used and a plain message. For a purchase goal that already exists, list_goals gives its projectedDate instead. To start saving, create_goal with kind "purchase". Nothing is bought or recorded.',
  input: purchaseInput.extend({
    savedCents: z.number().int().min(0).default(0),
    perPeriodCents: z.number().int().positive().nullable().default(null),
  }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, input) => {
    const { settings, today } = await settingsAndToday(ctx)
    const config = periodConfig(settings)
    const [check, surplus, goals] = await Promise.all([
      checkToday(ctx, settings, today, input),
      recentSurplus(ctx.db, settings, ctx.now()),
      listGoals(ctx.db, { today, period: config }),
    ])
    return planPurchase({
      amountCents: input.amountCents,
      savedCents: input.savedCents,
      today,
      check,
      perPeriodCents: input.perPeriodCents,
      surplusPerPeriodCents: surplus,
      // Goals already being saved for get the surplus first.
      goalsNeedPerPeriodCents: goals
        .filter((goal) => goal.status === 'in_progress')
        .reduce((sum, goal) => sum + (goal.perPeriodCents ?? 0), 0),
      config,
      money: (cents) => formatCents(cents, settings.currency, settings.locale),
    })
  },
})
