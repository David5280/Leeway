// The snapshot's lines read from the money check-in (domain/checkin.ts):
// what can be spent now, this budget period, bills due by payday, debts,
// the recent trend and what needs attention. Totals only: no account, bill
// or person is named, since the check-in's own messages can name them. Pure.

import type { Checkin } from '../domain/checkin.js'
import type { AttentionItem } from '../domain/coach.js'
import { untilWords } from '../domain/spendable.js'
import { monthYear } from '../domain/profile/insights.js'
import { shortDate } from '../lib/words.js'
import { isChatTool } from './tools.js'

type Money = (cents: number) => string

/** How the lines are written: whole amounts in the owner's currency, dates in their language. */
export interface LineFormat {
  money: Money
  locale: string
}

/** How many attention items are named; the rest are counted. */
export const ATTENTION_SHOWN = 3

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** What can be spent now, as the dashboard leads with it, with its note. */
export function spendNowLine({ spendable }: Checkin, { money, locale }: LineFormat): string {
  if (!spendable || spendable.limitedBy === 'none') {
    return `Can spend now: not known (no budget and no checking balance yet), which is not ${money(0)}.`
  }
  const note = spendable.note ? ` ${spendable.note}` : ''
  const lead = `${money(spendable.leadCents)}, ${money(spendable.perDayCents)} a day`
  return `Can spend now: ${lead}, ${untilWords(spendable, locale)}.${note}`
}

/** This budget period: what is spent, where budgeted spending is heading, and last period's pace. */
export function periodLine({ budget }: Checkin, { money, locale }: LineFormat): string {
  const dates = `${shortDate(budget.periodStart, locale)} to ${shortDate(budget.periodEnd, locale)}`
  const lead = `This budget period (${dates}, ${plural(budget.daysLeft, 'day')} left)`
  const spent = `${money(budget.spentCents)} spent`
  const last = `${money(budget.previousSpentToDateCents)} by this day last period`
  if (budget.budgetedCents === 0) return `${lead}: no budgets set; ${spent}, ${last}.`
  const heading = `budgeted spending heading for ${money(budget.projectedBudgetedCents)} of ${money(budget.budgetedCents)}`
  return `${lead}: ${spent}; ${heading}; ${last}.`
}

/** Bills due by payday, or that none are tracked, so nothing due is not read as nothing owed. */
export function billsDueLine({ bills, cashFlow }: Checkin, { money }: LineFormat): string {
  if (bills.count === 0) return 'Bills due by payday: not known, no bills are tracked.'
  return `Bills due by payday: ${money(cashFlow.billsDueCents)}.`
}

/** What is owed on cards and loans, and when minimums alone clear it. */
export function debtsLine({ debts }: Checkin, { money, locale }: LineFormat): string {
  if (!debts) return 'Debts: no card or loan has a balance.'
  const owed = `${money(debts.owedCents)} owed on cards and loans, ${money(debts.minimumsCents)} a month in minimums`
  if (!debts.debtFreeDate) return `Debts: ${owed}.`
  const free = `debt-free around ${monthYear(debts.debtFreeDate, locale)} paying minimums (${money(debts.totalInterestCents)} interest)`
  return `Debts: ${owed}; ${free}.`
}

/** Net worth and how it moved over the check-in's window. */
export function trendLine({ netWorth }: Checkin, { money }: LineFormat): string {
  const way = netWorth.changeCents < 0 ? 'down' : 'up'
  const moved =
    netWorth.changeCents === 0 ? 'unchanged' : `${way} ${money(Math.abs(netWorth.changeCents))}`
  const change = `${moved} over ${netWorth.sinceDays} days`
  return `Net worth: ${money(netWorth.netWorthCents)}, ${change}.`
}

/** Each attention topic in a few words, since the item's own message may name an account or bill. */
const TOPIC_WORDS: Record<AttentionItem['topic'], string> = {
  account: 'an account alert',
  bank: 'a bank connection',
  cash: 'cash before payday',
  bill: 'a bill',
  budget: 'a budget',
  goal: 'a goal',
  debt: 'debt details missing',
  cleanup: 'tidying up',
}

/** The tool Chat calls to learn more about an attention item. */
const moreFrom = (tool: string) => (isChatTool(tool) ? tool : 'get_checkin')

/** The most urgent attention items, each with its priority and the tool that tells more. */
export function attentionLine({ attention }: Checkin): string {
  if (attention.length === 0) return 'Needs attention: nothing right now.'
  const shown = attention
    .slice(0, ATTENTION_SHOWN)
    // An item may point at a tool Chat lacks (like update_goal); the check-in tells more instead.
    .map((item) => `${TOPIC_WORDS[item.topic]}, ${item.priority} (${moreFrom(item.tool)})`)
  const more = attention.length - shown.length
  const rest = more > 0 ? `; and ${more} more (get_checkin)` : ''
  return `Needs attention, most urgent first: ${shown.join('; ')}${rest}.`
}

/** Every check-in line, in the order the dashboard tells them. */
export function checkinLines(checkin: Checkin, format: LineFormat): string[] {
  return [
    spendNowLine(checkin, format),
    periodLine(checkin, format),
    billsDueLine(checkin, format),
    debtsLine(checkin, format),
    trendLine(checkin, format),
    attentionLine(checkin),
  ]
}
