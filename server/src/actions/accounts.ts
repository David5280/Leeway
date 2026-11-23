// Actions for bank and manual accounts: list, summarize, alerts, add by hand,
// rename, hide, set a low-balance warning, delete.

import { z } from 'zod'
import {
  accountPatchSchema,
  createManualAccount,
  deleteAccount,
  listAccounts,
  manualAccountInputSchema,
} from '../domain/accounts.js'
import { DEFAULT_LOW_BALANCE_CENTS, FEE_DAYS } from '../domain/accountAlerts.js'
import { getAccountsView } from '../domain/accountView.js'
import { listAlerts } from '../domain/alerts.js'
import { BILL_CHANGE_THRESHOLD } from '../domain/billAmountChange.js'
import { DUPLICATE_DAYS } from '../domain/leaks/duplicates.js'
import { PRICE_RISE } from '../domain/leaks/priceRises.js'
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
    'List bank and manual accounts with balances in cents. For credit and loan accounts the balance is the amount owed. kind says what each account is (checking, savings, retirement, pension, investment, credit_card, loan or other), from the bank or as the owner set it (kindChoice). unsharedAt is set when the bank no longer shares the account: its balance is as of balanceUpdatedAt and stays out of every total. includeHidden false lists only counted accounts, leaving out hidden and unshared ones.',
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
  title: 'Delete an account',
  description:
    'Delete an account and its transactions: a manual account, or a bank account whose bank no longer shares it (unsharedAt is set). Bank accounts still shared can only be hidden.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteAccount(ctx.db, id)
    return { deleted: true }
  },
})

/** list_alerts' description, one sentence or two per alert kind, so it reads as plain sentences. */
const LIST_ALERTS_PARTS = [
  'What is going wrong with accounts right now, most serious first.',
  'A checking or savings account overdrawn is kind "overdrawn", severity "urgent".',
  'A credit card over its limit is "over_limit", urgent.',
  `Overdraft or insufficient funds fees charged in the last ${FEE_DAYS} days are "overdraft_fee", warning, with the count and latest date.`,
  'Money available below the account\'s low-balance warning is "low_balance", warning.',
  `A bill whose latest charge was at least ${BILL_CHANGE_THRESHOLD.share * 100}% and ${BILL_CHANGE_THRESHOLD.cents} cents off its usual amount is "bill_change", warning when higher and info when lower, with the bill's id, name and usual amount and the charge's date.`,
  'A bill whose amount moves from cycle to cycle, such as power or water, raises none once its charges show it varies.',
  `Money leaks come in two kinds. The same merchant charging an account the same amount more than once within ${DUPLICATE_DAYS} days is "duplicate_charge", warning, with count saying how many times, unless that is routine there; each refund since settles one of the charges.`,
  'A bill paid twice in one cycle is told once, as "duplicate_charge", not also as "bill_change".',
  `A charge that repeats quarterly or more often, no bill tracking it, whose latest charge, on its usual cycle, rose at least ${PRICE_RISE.share * 100}% and ${PRICE_RISE.cents} cents over a steady price is "price_rise", warning, with charge.previousCents the old price and charge.previousId the charge a cycle before at it. A yearly charge never raises one, as a year of history holds too few of its charges to show a steady price.`,
  'Payments to people, cash withdrawals, checks, transfers and bank fees are never leaks.',
  'A leak has charge.id, its latest transaction, and charge.merchant, the merchant as the app shows it.',
  'When the charge is coded as rent, went through a payment app with no merchant named, or its name reads as a person\'s, charge.merchant is null and the alert names no one: "A repeating payment went up to ...", "A payment of ... went out twice".',
  "amountCents is how far overdrawn or over the limit, the balance left, the fees in all, what the bill's charge cost, what a duplicated charge was each time, or a risen price.",
  'Worked out from the balances of the last bank sync. Give accountIds for some accounts only.',
]

export const listAlertsAction = defineAction({
  name: 'list_alerts',
  title: 'List account alerts',
  description: LIST_ALERTS_PARTS.join(' '),
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
    'One or several accounts together, as the Accounts dashboard shows them: combined balances (cash as posted, available to spend, owed on cards and loans, credit left, net), money in and out over the last 4 budget periods (transfers left out), spending by category this period, recent transactions, alerts, and a short summary in plain words. Accounts the bank no longer shares (unsharedAt set) are listed but left out of the balances and alerts. Give accountIds to pick accounts; none means all. Amounts are in cents.',
  input: accountIdsInput,
  scope: 'read',
  surface: 'all',
  run: async (ctx, { accountIds }) => {
    const { settings } = await settingsAndToday(ctx)
    return getAccountsView(ctx.db, settings, ctx.now(), accountIds)
  },
})
