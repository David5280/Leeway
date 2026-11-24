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
  'funds are the sinking funds added, each with its cost (amountCents), cadence (quarter or year), nextDueDate, billId (the tracked bill it follows, whose name, amount and due dates it takes; null for one standing alone) and perPeriodCents (held back from safe to spend each budget period, the same way a goal set aside is; the cash flow does not count it). suggestions are costs not added or dismissed yet, with key, billId, name, amountCents, cadence, dueDate and basis (bill: a tracked yearly or quarterly bill; renewal: one large charge about a year ago that reads like insurance, a registration or a membership; holidays: December spending above a usual month). shareCents is the steady share of each paycheck (shareOf paycheck, the same payday get_cash_flow uses) or, while no pay is known, of each budget period (shareOf period) that covers the cost over its cycle. Amounts are in cents.'

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
    "Adds a sinking fund. For a bill's suggestion pass its billId alone: the fund follows the bill. Otherwise pass name, amountCents (the cost each time), cadence (quarter or year) and dueDate (when it is next due), with sourceKey set to a suggestion's key so it is not suggested again. Ask the owner first, since its share of each budget period is then held back from safe to spend, like a goal set aside. Refused when that bill or suggestion was already added. Returns the fund. Nothing moves money.",
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
  description:
    'Removes a sinking fund by id, so nothing is held back for it any more. A bill it follows stays tracked.',
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
