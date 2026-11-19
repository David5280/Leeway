// Actions for bills, subscriptions and recurring charges found in history.

import { z } from 'zod'
import {
  billInputSchema,
  billPatchSchema,
  createBill,
  deleteBill,
  listBills,
  updateBill,
} from '../domain/bills.js'
import { dismissRecurring, untrackedRecurring } from '../domain/recurring.js'
import { defineAction } from './action.js'
import { today } from './today.js'

const BILLS_EXPLAINED =
  'Amounts are in cents. cadence is week, biweek, semimonth, month, quarter or year, repeating from anchorDate (the first due date to track). A transaction whose name, as list_transactions shows it, contains matchPattern (case, digits and punctuation ignored) counts as paying the bill; reads is shown_name for such bills, and bank_text for one the owner set up in the app to read the bank text. status is paid, overdue (only the latest due date, and never for autopay), due_soon (within 7 days) or upcoming. Nothing here pays a bill.'

export const listBillsAction = defineAction({
  name: 'list_bills',
  title: 'List bills',
  description: `Bills and subscriptions, soonest due first, each with its next due date, status, last payment found and monthly cost, plus monthly totals. ${BILLS_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const bills = await listBills(ctx.db, await today(ctx))
    const monthly = (kind?: 'bill' | 'subscription') =>
      bills.filter((b) => !kind || b.kind === kind).reduce((sum, b) => sum + b.monthlyCents, 0)
    return {
      bills,
      monthlyCents: monthly(),
      subscriptionsMonthlyCents: monthly('subscription'),
    }
  },
})

export const createBillAction = defineAction({
  name: 'create_bill',
  title: 'Add a bill',
  description: `Track a bill or subscription. ${BILLS_EXPLAINED}`,
  input: billInputSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) =>
    createBill(ctx.db, input, await today(ctx), { byAssistant: ctx.agent }),
})

export const updateBillAction = defineAction({
  name: 'update_bill',
  title: 'Update a bill',
  description: `Change a bill. Only the fields given change. ${BILLS_EXPLAINED}`,
  input: billPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, ...patch }) =>
    updateBill(ctx.db, id, patch, await today(ctx), { byAssistant: ctx.agent }),
})

export const deleteBillAction = defineAction({
  name: 'delete_bill',
  title: 'Delete a bill',
  description: 'Stop tracking a bill. Its transactions are not touched.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteBill(ctx.db, id)
    return { deleted: id }
  },
})

export const findRecurringAction = defineAction({
  name: 'find_recurring',
  title: 'Find recurring charges',
  description:
    'Charges and deposits that repeat on a schedule in the last 400 days of transactions, still active, that are not tracked as a bill yet and were not dismissed. direction "out" is money spent (subscriptions, bills), "in" is money received (paychecks). Each has a cadence, typical amount in cents, whether the amount varies, the next expected date and a suggested kind. To track one, call create_bill with its key as matchPattern and nextDate as anchorDate; to stop suggesting it, call dismiss_recurring.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => untrackedRecurring(ctx.db, await today(ctx), { forAssistant: ctx.agent }),
})

export const dismissRecurringAction = defineAction({
  name: 'dismiss_recurring',
  title: 'Dismiss a recurring charge',
  description:
    'Stop suggesting a recurring charge from find_recurring, by the key it gave. It can still be added as a bill by hand.',
  input: z.object({ key: z.string().trim().min(1).max(200) }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { key }) => {
    await dismissRecurring(ctx.db, key, await today(ctx), { forAssistant: ctx.agent })
    return { dismissed: key }
  },
})
