import { z } from 'zod'
import { budgetReport } from '../domain/budget.js'
import { getSettings } from '../domain/settings.js'
import { defineAction } from './action.js'

export const getBudgetAction = defineAction({
  name: 'get_budget',
  title: 'Get the budget',
  description:
    "The budget for a period (offset 0 is the current one, -1 the previous): each category's budget, spending, what is left, pace and end-of-period projection, totals including safe-to-spend per day, alerts for categories over, near their limit, or ahead of pace, and spending in the previous period (in full and up to the same day). Amounts are in cents.",
  input: z.object({ offset: z.number().int().min(-120).max(12).default(0) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { offset }) =>
    budgetReport(ctx.db, await getSettings(ctx.db), ctx.now(), offset),
})
