// Actions for bank and manual accounts: list, summarize, alerts, add by hand,
// rename, hide, set a low-balance warning, delete.

import { z } from 'zod'
import {
  accountPatchSchema,
  createManualAccount,
  deleteManualAccount,
  listAccounts,
  manualAccountInputSchema,
} from '../domain/accounts.js'
import { DEFAULT_LOW_BALANCE_CENTS, FEE_DAYS } from '../domain/accountAlerts.js'
import { getAccountsView } from '../domain/accountView.js'
import { listAlerts } from '../domain/alerts.js'
import { updateAccountWithinPensionLimit } from '../domain/retirement/pensionStore.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

/** Some accounts by id; none, or ids that match no account, mean every account. */
const accountIdsInput = z.object({
  accountIds: z.array(z.uuid()).max(100).default([]),
})

export const listAccountsAction = defineAction({
  name: 'list_accounts',
  title: 'List accounts',
  description:
    'List bank and manual accounts with balances in cents. For credit and loan accounts the balance is the amount owed. kind says what each account is (checking, savings, retirement, pension, investment, credit_card, loan or other), from the bank or as the owner set it (kindChoice).',
  input: z.object({ includeHidden: z.boolean().default(true) }),
  scope: 'read',
  surface: 'all',
  run: (ctx, { includeHidden }) => listAccounts(ctx.db, includeHidden),
})

export const createAccountAction = defineAction({
  name: 'create_account',
  title: 'Add a manual account',
  description:
    'Track something the bank feed does not cover, such as cash, a house, a car or a private loan, so it counts in net worth. For a loan or card, balanceCents is what is owed.',
  input: manualAccountInputSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) => createManualAccount(ctx.db, input),
})

export const updateAccountAction = defineAction({
  name: 'update_account',
  title: 'Update an account',
  description: `Rename or hide an account, set its debt terms, or set lowBalanceCents: warn when the money available drops below it (null follows the default of ${DEFAULT_LOW_BALANCE_CENTS} cents for checking accounts and none for others; 0 turns it off), or kind: what kind of account it is (checking, savings, retirement, pension, investment, credit_card, loan or other; null goes back to the kind worked out from the bank). A card or loan can only be credit_card, loan or other, and an account owned cannot be either. Manual accounts can also change balance, credit limit and type.`,
  input: accountPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  // Marking an account a pension counts against the pension limit (pensionStore.ts).
  run: (ctx, { id, ...patch }) => updateAccountWithinPensionLimit(ctx.db, id, patch),
})

export const deleteAccountAction = defineAction({
  name: 'delete_account',
  title: 'Delete a manual account',
  description: 'Delete a manual account and its transactions. Bank accounts can only be hidden.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteManualAccount(ctx.db, id)
    return { deleted: true }
  },
})

export const listAlertsAction = defineAction({
  name: 'list_alerts',
  title: 'List account alerts',
  description: `What is going wrong with accounts right now, most serious first: a checking or savings account overdrawn (kind "overdrawn", severity "urgent"), a credit card over its limit ("over_limit", urgent), overdraft or insufficient funds fees charged in the last ${FEE_DAYS} days ("overdraft_fee", warning, with the count and latest date), and money available below the account's low-balance warning ("low_balance", warning). amountCents is how far overdrawn or over the limit, the balance left, or the fees in all. Worked out from the balances of the last bank sync. Give accountIds for some accounts only.`,
  input: accountIdsInput,
  scope: 'read',
  surface: 'all',
  run: async (ctx, { accountIds }) => {
    const { settings, today } = await settingsAndToday(ctx)
    return listAlerts(ctx.db, settings, today, accountIds)
  },
})

export const summarizeAccountsAction = defineAction({
  name: 'summarize_accounts',
  title: 'Summarize accounts',
  description:
    'One or several accounts together, as the Accounts dashboard shows them: combined balances (cash as posted, available to spend, owed on cards and loans, credit left, net), money in and out over the last 4 budget periods (transfers left out), spending by category this period, recent transactions, alerts, and a short summary in plain words. Give accountIds to pick accounts; none means all. Amounts are in cents.',
  input: accountIdsInput,
  scope: 'read',
  surface: 'all',
  run: async (ctx, { accountIds }) => {
    const { settings } = await settingsAndToday(ctx)
    return getAccountsView(ctx.db, settings, ctx.now(), accountIds)
  },
})
