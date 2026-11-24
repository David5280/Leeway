// Actions for the bigger picture: net worth, debt payoff and cash until payday.

import { z } from 'zod'
import { readBelowZero } from '../domain/belowZeroSource.js'
import { budgetSummaryWithRoom } from '../domain/budgetRoom.js'
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
    "Safe to spend until payday, the one figure every screen and summary uses: cash in counted checking accounts (available balance where known, else balance; savings, investments and retirement are left out), less every unpaid bill due by the next payday (one due on payday itself included, and an overdue one), less what an overdrawn account needs to get back to zero (overdraftCents). safeCents is never below zero; shortfallCents says how far the bills and overdrafts outrun the cash. perDayCents is safeCents per day until payday, counting today. paydaySource says where the payday came from: the paycheck budget period (exact), the main employer's next paycheck, the employer paying the most a month (detected_income, with expectedPayCents; paydayEstimate is true while its cadence is unconfirmed, from one paycheck or paydays that fit two cadences, and the payday is then the later, cautious reading), or the end of the budget period when no employer is paying yet. Pay the owner entered (set_pay) stands in for the main employer's paycheck. Spending from the budget is not subtracted. spendable is get_budget's: the budget's room held to this figure, leadCents and perDayCents being what the owner's dashboard leads with and what to quote. belowZero is null while checking lasts until payday; otherwise it says when checking first goes below zero (date, today with now true when it already is), the bills that take it there, shortCents (the shortfall) and cover: amountCents (rounded up to $10) to move into checking by byDate, and fromAccountName, the savings account holding enough, or null when none does. It is worked out from these same figures, so it always agrees with safeCents and shortfallCents. Suggestions only: Leeway never moves money. Amounts are in cents.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings } = await settingsAndToday(ctx)
    const { budget, cashFlow } = await budgetSummaryWithRoom(ctx.db, settings, ctx.now())
    const belowZero = await readBelowZero(ctx.db, cashFlow)
    return { ...cashFlow, spendable: budget.spendable, belowZero }
  },
})
