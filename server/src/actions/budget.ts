// The budget for a period, with alerts and a comparison to the period before.

import { z } from 'zod'
import { budgetReportWithRoom } from '../domain/budgetRoom.js'
import { getSettings } from '../domain/settings.js'
import { defineAction } from './action.js'

export const getBudgetAction = defineAction({
  name: 'get_budget',
  title: 'Get the budget',
  description:
    "The budget for a period (offset 0 is the current one, -1 the previous): each category's budget, spending, what is left, pace and end-of-period projection, totals, alerts for categories over, near their limit, or ahead of pace, and spending in the previous period (in full and up to the same day). For the current period, spendable says what can be spent now: the budget's room (budgetLeftCents) held to what is safe to spend before payday (safeCents: available cash in checking, less bills due before payday and any overdraft, never below zero; shortfallCents when they do not fit). leadCents is the lesser of the two and the figure to quote; note is the one line the owner sees when the budget has more room than the cash, and totals.safePerDayCents is held to the cash too. Amounts are in cents.",
  input: z.object({ offset: z.number().int().min(-120).max(12).default(0) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { offset }) =>
    budgetReportWithRoom(ctx.db, await getSettings(ctx.db), ctx.now(), offset),
})
