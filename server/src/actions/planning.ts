// Actions for the bigger picture: net worth, debt payoff and cash until payday.

import { z } from 'zod'
import { getCashFlow } from '../domain/cashFlow.js'
import { debtPlans } from '../domain/debts.js'
import { getNetWorth } from '../domain/netWorth.js'
import { recentBalances } from '../domain/recentBalances.js'
import { defineAction } from './action.js'
import { settingsAndToday, today } from './today.js'

export const getNetWorthAction = defineAction({
  name: 'get_net_worth',
  title: 'Get net worth',
  description:
    'Net worth from counted accounts: assets minus what is owed on cards and loans, in cents, plus its history (one point per day a balance changed) over the last `days`. Before Leeway first saw a balance, history is estimated: bank and card balances walked back through their transactions, and investment, loan and hand-kept accounts held at their first recorded balance. Points dated before estimatedBefore are such estimates (null when none are); say so when quoting them. historyStart is the first day history reaches, so a longer range shows nothing more.',
  input: z.object({ days: z.number().int().min(7).max(3660).default(365) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { days }) => getNetWorth(ctx.db, await today(ctx), days, { estimate: true }),
})

export const listRecentBalancesAction = defineAction({
  name: 'list_recent_balances',
  title: 'List recent balances',
  description:
    "Each account's balance once a day over the last 30 days, oldest first, for the line on its card.",
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => recentBalances(ctx.db, await today(ctx)),
})

export const planDebtPayoffAction = defineAction({
  name: 'plan_debt_payoff',
  title: 'Plan paying off debt',
  description:
    'Payoff plans for counted credit cards and loans with a balance, paying every minimum plus extraCents a month. Compares avalanche (highest rate first, least interest), snowball (smallest balance first, quickest wins) and minimums only: months to debt-free, the date, total interest and when each debt clears. Debts missing an APR (or, for loans, a payment) are listed under needsDetails and left out; set them with update_account (aprPercent, minimumPaymentCents). A card with no minimum uses the usual 1% plus interest, at least $25. This only plans; it never makes a payment.',
  input: z.object({ extraCents: z.number().int().min(0).max(100_000_000).default(0) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { extraCents }) => debtPlans(ctx.db, extraCents, await today(ctx)),
})

export const getCashFlowAction = defineAction({
  name: 'get_cash_flow',
  title: 'Get cash until payday',
  description:
    'Cash in counted checking accounts (available balance where known; savings is left out, as money set aside), every unpaid bill due before the next payday (including an overdue one), what is left after them and per day until payday, in cents. paydaySource says where the payday came from: the paycheck budget period (exact), a regular deposit found in history (detected_income, with expectedPayCents), or the end of the budget period as a stand-in. Spending from the budget is not subtracted; see get_budget for that.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today: date } = await settingsAndToday(ctx)
    return getCashFlow(ctx.db, settings, date)
  },
})
