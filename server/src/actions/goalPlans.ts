// Actions for the emergency fund goal (offered, started, and moved a step or
// pointed at the accounts that hold it) and for ranking goals against each other.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  changeEmergencyFund,
  getEmergencyFund,
  startEmergencyFund,
} from '../domain/emergencyGoal.js'
import { getGoalOrder, reorderGoals } from '../domain/goalRanking.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const EMERGENCY_EXPLAINED =
  'Amounts are in cents. essentials is essential spending in a typical month: cents, from ("spending" over recent whole months, or "bills" while spending is too new) and categories (the names counted as essential; null when all spending counts). By default the essential categories are found from their bank codes and names (housing, utilities, groceries, transport, health, insurance, loan payments), unless the owner picked them (savingsPlan.essentialCategoryIds in get_settings). months is the step the fund aims for in months of essentials (1, then 3, then 6, or the owner\'s longer emergencyFundMonths), targetCents that step\'s amount, savedCents what the counted accounts hold, and next the step after. accounts lists every checking and savings account that can hold the fund, each with counted; picked says whether the owner chose them (otherwise every savings account counts). goalId is null while the fund is only offered. Nothing here moves money.'

export const getEmergencyFundAction = defineAction({
  name: 'get_emergency_fund',
  title: 'Get the emergency fund goal',
  description: `The emergency fund goal, or the one-tap offer to start one at a month of essential spending when there is none. Null when there is no goal and essential spending is not known yet. ${EMERGENCY_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return getEmergencyFund(ctx.db, settings, today)
  },
})

export const startEmergencyFundAction = defineAction({
  name: 'start_emergency_fund',
  title: 'Start an emergency fund',
  description:
    'Starts the emergency fund goal at one month of essential spending, following every savings account. Returns the goal as list_goals does. Refused when one exists already, or when essential spending is not known yet.',
  input: z.object({}),
  scope: 'write',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return startEmergencyFund(ctx.db, settings, today)
  },
})

export const changeEmergencyFundAction = defineAction({
  name: 'change_emergency_fund',
  title: 'Change the emergency fund',
  description: `Moves the emergency fund to another step (months, resized from today's essential spending) or marks the accounts that hold it (accountIds: checking or savings accounts; empty goes back to every savings account). Only the fields given change. ${EMERGENCY_EXPLAINED}`,
  input: z.object({
    months: z.number().int().min(1).max(24).optional(),
    accountIds: z.array(z.uuid()).max(50).optional(),
  }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, change) => {
    const { settings, today } = await settingsAndToday(ctx)
    return withTransaction(ctx.db, (db) => changeEmergencyFund(db, settings, today, change))
  },
})

const ORDER_EXPLAINED =
  'Goals fill one after another in the owner\'s order: the first takes all of monthlyCents until it is reached, then the next. monthlyCents is the owner\'s own amount (source "entered", set with update_settings savingsPlan.goalsMonthlyCents), the recent pace into goals ("found") or nothing yet ("none", so no dates). Each goal comes back first to last with remainingCents, status, landsOn (the first day of the month it is reached; null once reached, for a stale goal, with no amount, or past fifty years) and ifMovedUp: what moving it one place up would do (its landsOn, and the goal it passes with that goal\'s new passedLandsOn), so a trade-off can be said plainly. Amounts are in cents. Nothing moves money.'

export const getGoalOrderAction = defineAction({
  name: 'get_goal_order',
  title: 'Get goals in order, with dates',
  description: `The owner's goals in their order of priority, with the month each lands in. ${ORDER_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return getGoalOrder(ctx.db, settings, today)
  },
})

export const reorderGoalsAction = defineAction({
  name: 'reorder_goals',
  title: 'Put goals in order',
  description: `Ranks goals, first to last, by id. Goals left out keep their order after the ones given, so naming one goal moves it to the top. Returns the order with its dates, as get_goal_order does. ${ORDER_EXPLAINED}`,
  input: z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { ids }) => {
    const { settings, today } = await settingsAndToday(ctx)
    await withTransaction(ctx.db, (db) => reorderGoals(db, ids))
    return getGoalOrder(ctx.db, settings, today)
  },
})
