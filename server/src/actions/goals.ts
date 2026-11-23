// Actions for savings goals and saving for a purchase.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  addToGoal,
  createGoal,
  deleteGoal,
  goalContributions,
  goalInputSchema,
  goalPatchSchema,
  listGoals,
  updateGoal,
} from '../domain/goals.js'
import { isoDateSchema } from '../lib/schemas.js'
import { defineAction } from './action.js'
import { goalClock } from './today.js'

const GOALS_EXPLAINED =
  'Amounts are in cents. kind is "savings" (a pot to fill) or "purchase" (saving for one thing: name is the item, targetCents its price, targetDate when it is wanted). A goal linked to an account (accountId) tracks that account balance as progress; otherwise progress is savedCents, counted by hand. Each goal comes back with currentCents, remainingCents, percent, status (reached, in_progress, past_due, stale when the bank of its linked account no longer shares it: progress is then as of balanceAsOf, and there is no plan; or trip_under_way and then trip_done for a trip budget\'s goal once its trip starts, being spent on the trip: never late, nothing more held back). A trip budget\'s goal (trip is not null) takes its targetCents and targetDate from the budget, so update_goal refuses to change them; they change on the trip\'s page in the app. and its plan in the owner\'s budget periods (monthly, weekly or per paycheck, see get_settings): perPeriodCents to set aside each period to make the date, thisPeriodLeftCents still to set aside this period, recentPerPeriodCents (the pace over the last 90 days), projectedDate (when that pace reaches it; null without recent progress), onTrack, and monthlyNeededCents. With setAside on (it needs a targetDate), heldBackCents is held back from safe-to-spend in get_budget. Goals never move money.'

export const listGoalsAction = defineAction({
  name: 'list_goals',
  title: 'List savings goals',
  description: `Savings goals and purchases being saved for, with progress and plans. ${GOALS_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => listGoals(ctx.db, await goalClock(ctx)),
})

export const createGoalAction = defineAction({
  name: 'create_goal',
  title: 'Add a savings goal',
  description: `Start a savings goal, or save for a purchase with kind "purchase". Ask the owner before turning on setAside, since it lowers what the app shows as safe to spend. ${GOALS_EXPLAINED}`,
  input: goalInputSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) => createGoal(ctx.db, input, await goalClock(ctx)),
})

export const updateGoalAction = defineAction({
  name: 'update_goal',
  title: 'Update a savings goal',
  description: `Change a goal. Only the fields given change. Changing savedCents corrects the count without recording a contribution; use add_to_goal for money put aside. ${GOALS_EXPLAINED}`,
  input: goalPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, ...patch }) => updateGoal(ctx.db, id, patch, await goalClock(ctx)),
})

export const addToGoalAction = defineAction({
  name: 'add_to_goal',
  title: 'Record savings toward a goal',
  description:
    'Record money set aside for a goal counted by hand, like "I put $50 toward it" (negative to record taking some back; more than was saved takes back what there is). date is the day it was put aside, today if left out. It is kept in the goal\'s history (list_goal_contributions) and counts toward its recent pace. This only updates the count; it does not move any money. Goals linked to an account update from its balance instead.',
  input: z.object({
    id: z.uuid(),
    amountCents: z
      .number()
      .int()
      .refine((n) => n !== 0, 'Use an amount other than zero'),
    date: isoDateSchema.optional(),
  }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, amountCents, date }) => {
    const clock = await goalClock(ctx)
    return withTransaction(ctx.db, (db) =>
      addToGoal(db, id, amountCents, date ?? clock.today, clock),
    )
  },
})

export const listGoalContributionsAction = defineAction({
  name: 'list_goal_contributions',
  title: 'List what was put toward a goal',
  description:
    'The amounts recorded toward a goal counted by hand, newest first: id, amountCents (negative for money taken back) and date. Goals linked to an account have none; their progress is the balance.',
  input: z.object({ id: z.uuid(), limit: z.number().int().min(1).max(100).default(10) }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, { id, limit }) => goalContributions(ctx.db, id, limit),
})

export const deleteGoalAction = defineAction({
  name: 'delete_goal',
  title: 'Delete a savings goal',
  description: 'Delete a goal and its history. No money or account is affected.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteGoal(ctx.db, id)
    return { deleted: id }
  },
})
