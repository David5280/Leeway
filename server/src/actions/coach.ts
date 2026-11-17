// Actions for coaching: a full check-in in one call, and "can I afford this?".

import { z } from 'zod'
import { affordability } from '../domain/afford.js'
import { budgetSummary } from '../domain/budgetReport.js'
import { getCashFlow } from '../domain/cashFlow.js'
import { getCheckin } from '../domain/checkin.js'
import { formatCents } from '../lib/money.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

export const getCheckinAction = defineAction({
  name: 'get_checkin',
  title: 'Money check-in',
  description:
    'Everything a coach needs in one call: the attention list (priority now, soon or fyi, each with a plain message and the tool that shows more), this budget period, cash until payday, bills, goals, debts (avalanche plan with no extra payment) and the net worth change over 30 days. Start any check-in or open question about money here. Amounts are in cents.',
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
    'Checks a purchase made today against cash until payday (after the bills due before it) and the budget. verdict is "yes", "tight" (fits, but pushes a budget over or halves the money left per day) or "no" (the bills before payday would not be covered). Give categoryId to check that category\'s budget too. reasons explain the verdict in plain words. Nothing is bought or recorded.',
  input: z.object({
    amountCents: z.number().int().positive(),
    categoryId: z.uuid().nullable().default(null),
  }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { amountCents, categoryId }) => {
    const { settings, today } = await settingsAndToday(ctx)
    const [cashFlow, budget] = await Promise.all([
      getCashFlow(ctx.db, settings, today),
      budgetSummary(ctx.db, settings, ctx.now()),
    ])
    const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
    return affordability(amountCents, cashFlow, budget, categoryId, money)
  },
})
