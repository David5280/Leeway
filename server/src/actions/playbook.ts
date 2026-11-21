// The payday playbook: closing out the last pay period and planning the
// new paycheck. Read-only, so an assistant can explain it; it never moves money.

import { z } from 'zod'
import { readPlaybook } from '../domain/playbook/read.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

export const getPaydayPlaybookAction = defineAction({
  name: 'get_payday_playbook',
  title: 'Get the payday playbook',
  description:
    "The payday playbook, most general first. closeOut is the last pay period closed out: budgetedCents is the flexible budgets (expense categories with a budget that track pace; fixed bills are left out) over its days, spentCents what was spent in them, and leftoverCents the difference (negative when spending went over), with each category. paycheck is the paycheck being planned: one that landed in the last few days (landed true, justPaid true) or the next one expected; null while no pay is known (then plan is null too; see get_pay). plan shares out toPlanCents (the paycheck plus leftoverCents) in priority order: bills (due before the next payday), sinking_funds (each fund's share of a paycheck), overdraft (bringing overdrawn checking back to zero), spending (the flexible budgets for a pay period, or usual spending when nothing is budgeted), goals (what each goal needs a paycheck to make its date), debt (half of what is still free toward the costliest card or loan, highest interest rate first), savings (the owner's savings rate target, or 10% of pay, plus anything still free at the end as extraCents) and events (upcoming events, once calendar data exists). Each step has needCents, amountCents (what the plan gives it) and items; shortCents is what did not fit, and billsShort says even the bills do not. overdraft.accounts is each checking account walked forward to the next payday from its balance, its usual day-to-day spending and the bills paid from it: belowZeroOn is the first day it would go below zero (null when it stays above), shortCents how far at its lowest, and move a suggested amount from another account that can spare it, by a day. pay is get_pay's answer. Everything here is a suggestion: say so, and never claim money was moved. Amounts are in cents.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return readPlaybook(ctx.db, settings, today)
  },
})
