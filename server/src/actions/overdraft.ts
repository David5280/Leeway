// The overdraft forecast as an action: will each checking account last until
// payday, and if not, which account could cover it. Read only: Leeway never
// moves money.

import { z } from 'zod'
import { readOverdraftForecast } from '../domain/overdraft/source.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

export const getOverdraftForecastAction = defineAction({
  name: 'get_overdraft_forecast',
  title: 'Get overdraft forecast',
  description:
    "Whether each checking account lasts until the next payday. Each account's balance now (the lower of its balances, negative when overdrawn) is walked forward a day at a time: the bills paid from it (bills with no account come out of the busiest checking account; ones paid from a card or savings leave checking alone) come out on their due dates, and its usual day-to-day spending (money out over the last eight weeks, less transfers between the owner's accounts and the bills counted on their own) comes out each day before payday. For each account: paydayCents (what it would hold on payday before the paycheck), lowestCents and lowestDate, belowZeroOn (the first day below zero, or null), shortCents (how far below zero at its lowest), overdrawnNow, spendingCents, the bills, and move: a suggested amount (rounded up to $10) to move from another checking account that stays above zero, or a savings account, by the day before it goes below zero, or null when no account can spare it. payday and paydayEstimate say when payday is and whether it is a guess. Suggestions only: Leeway never moves money. Accounts are named as the owner named them, never with account numbers. Amounts are in cents.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return readOverdraftForecast(ctx.db, settings, today)
  },
})
