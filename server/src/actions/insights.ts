// Read-only insights: trends, budget suggestions, top merchants and spending pace.

import { z } from 'zod'
import { budgetSummary } from '../domain/budgetReport.js'
import { categoryInputSchema } from '../domain/categories.js'
import {
  spendingPace,
  suggestBudgets,
  suggestForPlannedCategories,
  topMerchants,
  trends,
} from '../domain/insights.js'
import { getSettings } from '../domain/settings.js'
import { defineAction } from './action.js'

const offset = z.number().int().min(-120).max(12).default(0)

export const getTrendsAction = defineAction({
  name: 'get_trends',
  title: 'Spending over time',
  description:
    'Spending, income and per-category totals for each of the last N budget periods, oldest first, ending with the current period. Use it to compare months, spot creep, and explain changes.',
  input: z.object({ periods: z.number().int().min(2).max(36).default(6) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { periods }) => trends(ctx.db, await getSettings(ctx.db), ctx.now(), periods),
})

export const suggestBudgetsAction = defineAction({
  name: 'suggest_budgets',
  title: 'Suggest budgets',
  description:
    'Monthly budget suggestions per spending category, from the average of the last three full months, rounded up to a tidy number. Nothing is changed; use update_category to apply one.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => suggestBudgets(ctx.db, await getSettings(ctx.db), ctx.now()),
})

export const suggestStarterBudgetsAction = defineAction({
  name: 'suggest_starter_budgets',
  title: 'Suggest budgets for new categories',
  description:
    'For categories not created yet (first-run setup), the monthly average spent in each over the last three months, by bank category.',
  input: z.object({ categories: z.array(categoryInputSchema).max(100) }),
  scope: 'read',
  surface: 'app',
  run: async (ctx, { categories }) =>
    suggestForPlannedCategories(ctx.db, await getSettings(ctx.db), ctx.now(), categories),
})

export const topMerchantsAction = defineAction({
  name: 'top_merchants',
  title: 'Top merchants',
  description:
    'Where the money went in a budget period, by merchant, biggest first. Lines the bank sent with no readable merchant are left out.',
  input: z.object({ offset, limit: z.number().int().min(1).max(50).default(8) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { offset, limit }) =>
    topMerchants(ctx.db, await getSettings(ctx.db), ctx.now(), offset, limit),
})

export const getSpendingPaceAction = defineAction({
  name: 'get_spending_pace',
  title: 'Spending pace',
  description:
    'Day-by-day running total of flexible spending (budgeted categories that track pace) in a period, with the combined budget and an end-of-period projection.',
  input: z.object({ offset }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { offset }) => {
    const settings = await getSettings(ctx.db)
    const summary = await budgetSummary(ctx.db, settings, ctx.now(), offset)
    const flexible = new Map(
      summary.categories
        .filter((c) => c.kind === 'expense' && c.budgetCents !== null && c.pace !== null)
        .map((c) => [c.categoryId, c.budgetCents!]),
    )
    return spendingPace(ctx.db, settings, ctx.now(), offset, flexible)
  },
})
