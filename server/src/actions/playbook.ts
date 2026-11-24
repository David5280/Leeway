// The payday playbook: closing out the pay period that just ended and
// planning the new paycheck. Read only, so an assistant can explain it; it
// never moves money.

import { z } from 'zod'
import { readPlaybook } from '../domain/playbook/read.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const DESCRIPTION = [
  'The payday playbook: what was left of the last pay period, what to do with it, and a plan for the new paycheck.',
  'lastPayday is the latest payday on or before today (null while no pay schedule is known) and justPaid is true for a few days after it; nextPayday, paydaySource and paydayEstimate are the same payday get_cash_flow gives.',
  'closeOut is the pay period that just closed (start to end, both included; null with no pay schedule): budgetedCents is one pay period of the flexible budgets (expense categories with a budget that track pace; fixed bills are left out), spentCents what was spent in them (transfers between own accounts never count), and leftoverCents the difference, negative when spending went over, with each category.',
  'suggestions share out a positive leftover in order: emergency_fund (what the fund is short of its target), goal (the open goals due soonest, each with its targetDate or null), debt (the highest interest debt), retirement (what a pay period needs to reach the savings rate target; a nudge toward it, never call the owner short or behind, as the rate may miss a 401(k) taken from pay) and idle_cash (checking holding more than it needs until payday); empty when nothing was left.',
  "plan is the new paycheck: paycheckCents (the usual paycheck, null when unknown), lines of bills due before nextPayday and set-asides (goals, trip budgets and sinking funds, each one paycheck's share of what the budget's room holds back), billsCents, setAsideCents, leftCents (the paycheck less both, for everyday spending), safeToSpendCents (what can be spent now: get_cash_flow's spendable.leadCents, the lesser of the budget's room after set-asides and cash safe to spend; quote it as is and never subtract the set-asides from it again) and short (when checking may go below zero before payday, with a suggested amount to move in by a day; null when it lasts).",
  'Everything here is a suggestion: say so, and never claim money was moved. Amounts are in cents.',
].join(' ')

export const getPaydayPlaybookAction = defineAction({
  name: 'get_payday_playbook',
  title: 'Get the payday playbook',
  description: DESCRIPTION,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return readPlaybook(ctx.db, settings, today, ctx.now())
  },
})
