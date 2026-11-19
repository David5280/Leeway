// Actions for savings and the financial profile: read-only pictures of what
// the owner has, built fresh from the stored data on every call.

import { z } from 'zod'
import type { AppContext } from '../context.js'
import { formatWholeCents } from '../lib/money.js'
import { profileDigest } from '../domain/profile/digest.js'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { savingsView } from '../domain/profile/views.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

/** The profile, with whole-amount money words in the owner's currency and language. */
async function loadProfile(ctx: AppContext) {
  const { settings, today } = await settingsAndToday(ctx)
  const profile = await getFinancialProfile(ctx.db, settings, today)
  const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
  return { profile, format: { money, locale: settings.locale } }
}

export const summarizeSavingsAction = defineAction({
  name: 'summarize_savings',
  title: 'Summarize savings and investments',
  description:
    'Savings, retirement and investing accounts as the Savings, Retirement and Investing screens show them: a grand total with its change this month (month), over the last 30 days (days30), the last year (year) and all history (all), the total over time (history), the savings rate and the owner\'s target for it, contributions and overall insights, then one lens per kind (savings, retirement, investment). Every lens has the same parts: a question with a one-line answer (headline null means Leeway cannot tell yet, and detail says what it needs), two meters, the insight that adds most, and the accounts; plus its total, changes, history, goals and, for savings, the emergency fund (months of essential spending covered against the target the owner set). Changes include deposits and market moves together, so they are not returns. A change is null where balance history does not reach back that far (it starts when Leeway first saw an account: historyStartsOn); accountsLeftOut counts accounts without history that far back. contributions are transfers from everyday accounts that the bank labeled as going to savings ("cash") or to investment and retirement accounts ("invested") over the last year, or null when none were found; payroll deductions never show in bank transactions. savingsRate is null when pay or any saving is unknown: never read a missing rate as saving nothing. Accounts with no balance or in another currency are listed with notCounted and left out of totals. Amounts are in cents. Read-only.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { profile, format } = await loadProfile(ctx)
    return savingsView(profile, format)
  },
})

export const getFinancialProfileAction = defineAction({
  name: 'get_financial_profile',
  title: 'Get the financial profile',
  description:
    'A short digest of the whole financial picture, in plain facts: pay schedule, a typical month of income and spending, bills, every kind of account with totals, savings and investments, the emergency fund, the savings rate, goals, and what Leeway does not know yet. Read it before coaching, so advice fits the real numbers. Totals only: no transactions or account details. Read-only.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { profile, format } = await loadProfile(ctx)
    return { asOf: profile.asOf, digest: profileDigest(profile, format.money) }
  },
})
