// Actions for the emergency fund goal: offered, started, and moved a step or
// pointed at the accounts that hold it.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  changeEmergencyFund,
  getEmergencyFund,
  startEmergencyFund,
} from '../domain/emergencyGoal.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const EMERGENCY_EXPLAINED =
  'Amounts are in cents. essentials is essential spending in a typical month: cents, from ("spending" over recent whole months, or "bills" while spending shows none), categories and categoryIds (the categories counted as essential; null when bills size it or all spending counts) and picked (whether the owner chose them, true even while bills size it). essentialsChoice holds pickedIds (the owner\'s picked category ids, or null when Leeway finds them) and spentIds (the expense categories with spending in the months averaged). When the owner\'s picked categories had no spending and there are no bills, the offer still shows with essentials null, months null and targetCents 0, so the choice can be changed. By default the essential categories are found from their bank codes, or their names when they have none: housing, utilities, groceries, transport, health, insurance, child care and fixed loan payments (a mortgage, car, student or personal loan), never credit card payments; the owner can pick them instead (savingsPlan.essentialCategoryIds in update_settings). months is how many months of essentials the target is: the step the fund aims for (1, then 3, then 6, stopping at the owner\'s emergencyFundMonths), or with ownTarget the owner\'s own amount told in months. targetCents is the target, savedCents what the fund holds (the same figure the financial profile uses), monthsCovered how many months of essentials that is, and next the step after. counts says where progress comes from: "savings" (every savings account no other goal follows), "marked" (the accounts the owner marked), "account" (the one account linked with update_goal) or "hand" (a count kept by hand, for a goal the owner named as an emergency fund before Leeway offered one; such a goal is taken as the fund instead of a second). A goal reads as the fund only when its whole name is one, such as "Emergency fund", "Emergency savings" or "Rainy day fund". An account another goal follows counts toward that goal only: a fund linked to one counts nothing from it, and linking one is refused. accounts lists the checking and savings accounts it could count, each with counted, marked, leftOut (hidden, not_shared, other_goal or unavailable, with otherGoal naming the goal that follows it) or null. goalId is null while the fund is only offered. Nothing here moves money.'

export const getEmergencyFundAction = defineAction({
  name: 'get_emergency_fund',
  title: 'Get the emergency fund goal',
  description: `The emergency fund goal, or the one-tap offer to start one at a month of essential spending when there is none. Null when there is no goal, essential spending is not known yet and the owner picked no essentials. ${EMERGENCY_EXPLAINED}`,
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
    'Starts the emergency fund goal at one month of essential spending, following every savings account no other goal follows. Returns the goal as list_goals does. Refused when there is a fund already (a goal named "Emergency fund", "Rainy day fund" and the like counts as one), or when essential spending is not known yet.',
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
  description: `Moves the emergency fund to another step (months, sized from today's essential spending, which replaces an own target) or marks the accounts that hold it (accountIds: checking or savings accounts no other goal follows; empty goes back to every savings account), or counts it by hand again (byHand, from the count it kept; not with accountIds). Only the fields given change. ${EMERGENCY_EXPLAINED}`,
  input: z
    .object({
      months: z.number().int().min(1).max(24).optional(),
      accountIds: z.array(z.uuid()).max(50).optional(),
      byHand: z.literal(true).optional(),
    })
    .refine((change) => !(change.byHand && change.accountIds), {
      message: 'Give accountIds or byHand, not both',
    }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, change) => {
    const { settings, today } = await settingsAndToday(ctx)
    return withTransaction(ctx.db, (db) => changeEmergencyFund(db, settings, today, change))
  },
})
