// Reads what the idle cash check needs (idleCash.ts) from stored data: the
// cash in checking, payday and the bills due by then, all from the cash flow
// so the two cards always agree; what the cards owe, typical everyday
// spending from past months, whether any account is overdrawn, and whether
// safe to spend is tight. Each step is its own small function so the rules
// can be tested without a database.

import type { Db } from '../db/pool.js'
import { addDays, daysInMonth, dateParts, type IsoDate } from '../lib/dates.js'
import { isCounted } from './accountSharing.js'
import { listAccounts, type Account } from './accounts.js'
import { alertsFor } from './alerts.js'
import type { BudgetSummary } from './budget.js'
import { budgetSummary } from './budgetReport.js'
import { getCashFlow, type CashFlow } from './cashFlow.js'
import { checkIdleCash, type IdleCash } from './idleCash.js'
import { billPaymentsByRange } from './idleCashBills.js'
import { monthlyTotals, wholeMonths, type MonthTotals } from './monthlyTotals.js'
import type { Settings } from './settings.js'

/** Past months read for typical spending: the last three whole ones. */
const SPENDING_MONTHS = 3

/** What counted credit cards owe. A card in credit (a negative balance) owes nothing. */
export function cardsOwed(accounts: Account[]): number {
  return accounts
    .filter((account) => isCounted(account) && account.kind === 'credit_card')
    .reduce((sum, account) => sum + Math.max(0, account.balanceCents ?? 0), 0)
}

/**
 * Typical everyday spending a day: each finished month's spending less what
 * went to bills (paidToBills, in the months' order), averaged over their
 * days. Null with no finished month the history fully covers. Spending on
 * cards counts, since checking pays the card.
 */
export function dailySpend(months: MonthTotals[], paidToBills: number[]): number | null {
  const finished = months
    .map((month, i) => ({ month, paid: paidToBills[i] ?? 0 }))
    .filter(({ month }) => !month.current)
  if (finished.length === 0) return null
  const days = finished.reduce((sum, { month }) => {
    const { year, month: number } = dateParts(month.start)
    return sum + daysInMonth(year, number)
  }, 0)
  // A refund can net a bill's category below what was paid, so never below zero.
  const spent = finished.reduce(
    (sum, { month, paid }) => sum + Math.max(0, month.spentCents - paid),
    0,
  )
  return Math.round(spent / days)
}

/** Whether any account is overdrawn, as the overdrawn alert reads it. */
export function anyOverdrawn(accounts: Account[], settings: Settings): boolean {
  return alertsFor(accounts, [], settings).some((alert) => alert.kind === 'overdrawn')
}

/**
 * Whether safe to spend is tight: the cash flow is short of the bills due by
 * payday, or the budgets are spent to (or past) what they allow.
 */
export function isTight(
  flow: Pick<CashFlow, 'shortfallCents'>,
  totals: Pick<BudgetSummary['totals'], 'budgetedCents' | 'leewayCents'>,
): boolean {
  return flow.shortfallCents > 0 || (totals.budgetedCents > 0 && totals.leewayCents <= 0)
}

/** Typical everyday spending a day, from the last SPENDING_MONTHS whole months. */
async function typicalDailySpend(db: Db, settings: Settings, now: Date): Promise<number | null> {
  const months = wholeMonths(await monthlyTotals(db, settings, now, SPENDING_MONTHS + 1))
  // MonthTotals' end is inclusive; a range's end is not.
  const ranges = months.map((month) => ({ start: month.start, end: addDays(month.end, 1) }))
  const paid = await billPaymentsByRange(db, ranges, settings.includePending)
  return dailySpend(months, paid)
}

/** Whether checking holds cash that could earn more in savings, worked out now. */
export async function getIdleCash(
  db: Db,
  settings: Settings,
  today: IsoDate,
  now: Date,
): Promise<IdleCash> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const flow = await getCashFlow(db, settings, today)
  const accounts = await listAccounts(db)
  const daily = await typicalDailySpend(db, settings, now)
  const budget = await budgetSummary(db, settings, now)
  return checkIdleCash({
    checkingCents: flow.cashCents,
    // Payday's own bills included: pay can land after a bill drawn the same day.
    billsCents: flow.billsDueCents,
    cardsOwedCents: cardsOwed(accounts),
    dailySpendCents: daily,
    daysUntilPayday: flow.daysUntilPayday,
    nextPayday: flow.nextPayday,
    paydayKnown: flow.paydaySource !== 'period_end',
    overdrawn: anyOverdrawn(accounts, settings),
    tight: isTight(flow, budget.totals),
  })
}
