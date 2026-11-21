// Actions for sinking funds: yearly and irregular costs saved toward a
// little each paycheck. Nothing here moves money.

import { z } from 'zod'
import { cadenceOf } from '../lib/periods.js'
import { periodConfig } from '../domain/settings.js'
import {
  createFund,
  deleteFund,
  dismissFundSuggestion,
  fundInputSchema,
} from '../domain/sinkingFunds/funds.js'
import { readSinkingFunds } from '../domain/sinkingFunds/view.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const VIEW =
  'funds are the sinking funds added, each with its cost (amountCents), cadence (quarter or year), nextDueDate, perPeriodCents (held back from the budget each budget period, like a goal set aside) and shareCents. suggestions are yearly or irregular costs found in the history and not added or dismissed yet: basis says why (bill: a tracked yearly or quarterly bill; repeating: a charge repeating yearly or quarterly; renewal: one large charge about a year ago that reads like insurance, a registration or a membership; holidays: December spending above a usual month), with key, name, amountCents, cadence, dueDate and lastDate. shareCents is the steady share of each paycheck (shareOf paycheck) or, while no pay is known, of each budget period (shareOf period) that covers the cost over its cycle. Amounts are in cents.'

export const listSinkingFundsAction = defineAction({
  name: 'list_sinking_funds',
  title: 'List sinking funds',
  description: `Sinking funds and suggestions for them. ${VIEW}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return readSinkingFunds(ctx.db, settings, today)
  },
})

export const addSinkingFundAction = defineAction({
  name: 'add_sinking_fund',
  title: 'Add a sinking fund',
  description:
    "Adds a sinking fund: name, amountCents (the cost each time), cadence (quarter or year) and dueDate (when it is next due). Pass sourceKey with a suggestion's key from list_sinking_funds so it is not suggested again. Its share of each budget period is then held back from what is left to spend, like a goal set aside. Refused when that suggestion was already added. Returns the fund. Nothing moves money.",
  input: fundInputSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) => {
    const { settings, today } = await settingsAndToday(ctx)
    return createFund(ctx.db, input, today, cadenceOf(periodConfig(settings)))
  },
})

export const deleteSinkingFundAction = defineAction({
  name: 'delete_sinking_fund',
  title: 'Delete a sinking fund',
  description: 'Removes a sinking fund by id, so nothing is held back for it any more.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteFund(ctx.db, id)
    return { deleted: true }
  },
})

export const dismissSinkingFundAction = defineAction({
  name: 'dismiss_sinking_fund',
  title: 'Dismiss a sinking fund suggestion',
  description:
    "Stops suggesting a cost as a sinking fund, by the suggestion's key from list_sinking_funds.",
  input: z.object({ key: z.string().min(1).max(200) }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { key }) => {
    await dismissFundSuggestion(ctx.db, key)
    return { dismissed: true }
  },
})
