// Actions for the owner's pay: what the paychecks show, a one-tap
// confirmation of it, and the owner's own pay in its place.

import { z } from 'zod'
import { confirmPay, setPay } from '../domain/pay/owner.js'
import { payOverrideSchema } from '../domain/pay/ownPay.js'
import { readPayView } from '../domain/pay/view.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const PAY_FIELDS =
  'found is what the paychecks show (null when no employer is paying now): each employer paying now with an id and its name (as the bank shows the deposit, never with an account number; null when the payer is not a business, such as a payroll paid in the name of a person), its usual paycheck, cadence (week, biweek, semimonth or month), next payday, paychecks seen, estimate (true until a second paycheck or the owner confirms that job), confirmed (the owner said the pay of this job is right) and replaced (true when the pay the owner entered stands in for that job); found.estimate is true while any job is a guess, and found.confirmed says the owner confirmed a job, which stays confirmed while it pays that way, however it ranks; confirmationStale says the owner confirmed an earlier reading the paychecks no longer show, so it may be worth confirming again. yours is the pay the owner entered (null for none) with what it comes to a month, used instead of the job it replaces; jobStopped is true when the job it was entered for has stopped paying, so it replaces no job and counts beside the jobs still paying until the owner updates or removes it. pay is what every figure (safe to spend, typical income, the payday playbook) goes by, with source found, confirmed or yours. lastPaycheck is the newest paycheck that landed. period is a paycheck budget period on the schedule of the pay in use. Money from people (Venmo, Zelle), refunds, tax refunds and transfers are never pay. Amounts are in cents.'

export const getPayAction = defineAction({
  name: 'get_pay',
  title: 'Get pay',
  description: `The owner's pay. ${PAY_FIELDS}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return readPayView(ctx.db, settings, today)
  },
})

export const confirmPayAction = defineAction({
  name: 'confirm_pay',
  title: 'Confirm pay',
  description: `Says the pay Leeway found is right, so it stops being an estimate, and clears any pay the owner entered. A paycheck budget period moves to the confirmed schedule. Refused when no paycheck has been found. Returns get_pay's answer. ${PAY_FIELDS}`,
  input: z.object({}),
  scope: 'write',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return confirmPay(ctx.db, settings, today)
  },
})

export const setPayAction = defineAction({
  name: 'set_pay',
  title: 'Set pay',
  description: `Sets the owner's own pay, used everywhere instead of what the paychecks show: amountCents for one paycheck, cadence (week, biweek, semimonth or month) and nextPayday (within a year of today; later paydays repeat from it). With two jobs it stands in for the main one, or for the job it already stands in for. pay null goes back to the paychecks as found, clearing the pay the owner entered and any confirmation. A paycheck budget period moves to the new schedule, or back to the paychecks' when they show one (with no paychecks found it stays on the schedule it had). Returns get_pay's answer. ${PAY_FIELDS}`,
  input: z.object({ pay: payOverrideSchema.nullable() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { pay }) => {
    const { settings, today } = await settingsAndToday(ctx)
    return setPay(ctx.db, settings, pay, today)
  },
})
