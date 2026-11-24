// Actions for savings and the financial profile: read-only pictures of what
// the owner has, built fresh from the stored data on every call.

import { z } from 'zod'
import type { AppContext } from '../context.js'
import { formatWholeCents } from '../lib/money.js'
import { profileDigest } from '../domain/profile/digest.js'
import type { InsightFormat } from '../domain/profile/insights.js'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { savingsView } from '../domain/profile/views.js'
import type { Settings } from '../domain/settings.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

/** Whole-amount money words in the owner's currency and language, for lenses and insights. */
export function insightFormat(settings: Settings): InsightFormat {
  const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
  return { money, locale: settings.locale }
}

/** The profile, with the words to tell it in. */
async function loadProfile(ctx: AppContext) {
  const { settings, today } = await settingsAndToday(ctx)
  const profile = await getFinancialProfile(ctx.db, settings, today)
  return { profile, format: insightFormat(settings) }
}

/**
 * What summarize_savings returns, one part of the picture per line, so each
 * can be read and changed on its own. Joined into one description below.
 */
const SUMMARIZE_SAVINGS_PARTS = [
  'Savings, retirement and investing accounts, worked out with no AI.',
  'The whole picture first: the grand total and its change this month (month), over the last 30 days (days30), the last year (year) and all history (all); the total over time (history); the savings rate and any target the owner set; contributions; and insights about the whole picture.',
  'Then one lens per kind the owner has (savings, retirement, investment), each with the same parts: a question with a one-line answer (headline null means Leeway cannot tell yet, and detail says what it needs), two or three meters, the insight that adds most, the accounts, its total, changes, history and goals, and for savings the emergency fund (months of essential spending covered against the target the owner set).',
  'The retirement lens shows whenever there is a retirement account, a pension or a birth year, and also carries the retirement plan and a card per pension; project_retirement gives the same on its own, with what-ifs.',
  'Changes count deposits and market moves together, so they are not returns. A change is null where balance history does not reach back that far (it starts when Leeway first saw an account: historyStartsOn); accountsLeftOut counts accounts without history from the start of the change.',
  'contributions are net transfers from everyday accounts that the bank labeled as going to savings ("cash") or to investment and retirement accounts ("invested") over the last year, less any moved back, or null when none were found.',
  'savingsRate counts money moved through the bank, plus the payroll deductions Leeway knows (sources with beforePaycheck true): pension contributions the owner entered, the 401(k), 457 or 403(b) a paystub from the last six months shows, and the employer match a confirmed paystub from the last six months shows. Any other payroll deduction is left out, so never tell the owner they save too little. A pension is retirement saving: never call someone with one under-saving for retirement for putting little or nothing in a 401(k), IRA or brokerage account. It is null when pay or any saving is unknown; never read a missing rate as saving nothing.',
  'Accounts with no balance or in another currency are listed with notCounted and left out of totals. Amounts are in cents. Read-only.',
]

export const summarizeSavingsAction = defineAction({
  name: 'summarize_savings',
  title: 'Summarize savings and investments',
  description: SUMMARIZE_SAVINGS_PARTS.join(' '),
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
    'A short digest of the whole financial picture, in plain facts: pay schedule (from the paychecks of every employer paying now, each in pay.employers with its own estimate flag and named only when the bank names a business, never a person, true while its cadence is unconfirmed: one paycheck, or paydays that fit two cadences; pay.estimate is that of the main employer, whose next payday is the one given; pay.entered is the pay the owner entered when it stands in for no job found, the main pay then, with every employer listed counting beside it), a typical month of income (paychecks only, never money from people, refunds or transfers in) and spending, bills, every kind of account with totals, savings and investments, the emergency fund, the savings rate, goals, and what Leeway does not know yet. Read it before coaching, so advice fits the real numbers. The savings rate counts money moved through the bank, any pension contributions the owner entered, the 401(k), 457 or 403(b) a paystub from the last six months shows, and the employer match a confirmed paystub from the last six months shows. Any other payroll deduction is left out, so never say it is too little. While the newest paystub is a recent one the owner confirmed in full, a line gives its yearly gross pay (and what it was worked out from), income tax withheld through its pay date (named by year when that is not this year), the share of gross withheld in all taxes (withholding, not what is owed) and the share of gross going to retirement from pay; a typical paycheck marked as from a confirmed paystub is its take-home, standing in for the bank deposit amount while that job still pays on the same schedule as the paystub and its deposits have not changed since. Pensions and a retirement projection, when the owner gave a birth year, are included as ranges. Totals only: no transactions or account details. Read-only.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { profile, format } = await loadProfile(ctx)
    return { asOf: profile.asOf, digest: profileDigest(profile, format.money) }
  },
})
