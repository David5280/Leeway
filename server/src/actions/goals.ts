// Actions for savings goals.

import { z } from 'zod'
import {
  addToGoal,
  createGoal,
  deleteGoal,
  goalInputSchema,
  goalPatchSchema,
  listGoals,
  updateGoal,
} from '../domain/goals.js'
import { defineAction } from './action.js'
import { today } from './today.js'

const GOALS_EXPLAINED =
  'Amounts are in cents. A goal linked to an account (accountId) tracks that account balance as progress; otherwise progress is savedCents, counted by hand. Each goal comes back with currentCents, remainingCents, percent, monthsLeft, monthlyNeededCents to make the target date, and status (reached, in_progress or past_due). Goals never move money.'

export const listGoalsAction = defineAction({
  name: 'list_goals',
  title: 'List savings goals',
  description: `Savings goals and progress toward them. ${GOALS_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => listGoals(ctx.db, await today(ctx)),
})

export const createGoalAction = defineAction({
  name: 'create_goal',
  title: 'Add a savings goal',
  description: `Start a savings goal. ${GOALS_EXPLAINED}`,
  input: goalInputSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) => createGoal(ctx.db, input, await today(ctx)),
})

export const updateGoalAction = defineAction({
  name: 'update_goal',
  title: 'Update a savings goal',
  description: `Change a goal. Only the fields given change. ${GOALS_EXPLAINED}`,
  input: goalPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, ...patch }) => updateGoal(ctx.db, id, patch, await today(ctx)),
})

export const addToGoalAction = defineAction({
  name: 'add_to_goal',
  title: 'Record savings toward a goal',
  description:
    'Record money set aside for a goal counted by hand (negative to record taking some back). This only updates the count; it does not move any money. Goals linked to an account update from its balance instead.',
  input: z.object({
    id: z.uuid(),
    amountCents: z
      .number()
      .int()
      .refine((n) => n !== 0, 'Use an amount other than zero'),
  }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, amountCents }) => addToGoal(ctx.db, id, amountCents, await today(ctx)),
})

export const deleteGoalAction = defineAction({
  name: 'delete_goal',
  title: 'Delete a savings goal',
  description: 'Delete a goal. No money or account is affected.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteGoal(ctx.db, id)
    return { deleted: id }
  },
})
