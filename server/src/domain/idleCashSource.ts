// Reads what the idle cash check needs (idleCash.ts) from stored data: the
// cash until payday, typical spending from past months, whether any account
// is overdrawn, and whether safe to spend is tight.

import type { Db } from '../db/pool.js'
import { daysInMonth, dateParts, type IsoDate } from '../lib/dates.js'
import { isShared } from './accountSharing.js'
import { listAccounts, type Account } from './accounts.js'
import { budgetSummary } from './budgetReport.js'
import { getCashFlow } from './cashFlow.js'
import { checkIdleCash, type IdleCash } from './idleCash.js'
import { monthlyTotals, wholeMonths, type MonthTotals } from './monthlyTotals.js'
import type { Settings } from './settings.js'

/** Past months read for typical spending: the last three whole ones. */
const SPENDING_MONTHS = 3

/**
 * Typical spending a day: the finished months' spending, averaged over their
 * days. Null with no finished month the history fully covers. Spending on
 * cards counts, since checking pays the card.
 */
export function dailySpend(months: MonthTotals[]): number | null {
  const finished = months.filter((month) => !month.current)
  if (finished.length === 0) return null
  const days = finished.reduce((sum, month) => {
    const { year, month: number } = dateParts(month.start)
    return sum + daysInMonth(year, number)
  }, 0)
  const spent = finished.reduce((sum, month) => sum + month.spentCents, 0)
  return Math.round(spent / days)
}

/** Whether any account the bank still shares is below zero, as the overdrawn alert reads it. */
export function anyOverdrawn(accounts: Account[]): boolean {
  return accounts
    .filter((account) => account.type === 'depository' && isShared(account))
    .some((account) => Math.min(account.balanceCents ?? 0, account.availableCents ?? 0) < 0)
}

/** Whether checking has spare cash to suggest saving, worked out now. */
export async function getIdleCash(
  db: Db,
  settings: Settings,
  today: IsoDate,
  now: Date,
): Promise<IdleCash> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const flow = await getCashFlow(db, settings, today)
  const accounts = await listAccounts(db)
  const months = await monthlyTotals(db, settings, now, SPENDING_MONTHS + 1)
  const budget = await budgetSummary(db, settings, now)
  const daily = dailySpend(wholeMonths(months))
  // Seam for true-numbers: once its safe to spend lands, `tight` should come
  // from it (a shortfall, or a lead figure under typical spending) and
  // checkingCents from its cash. Until then: bills outrunning the cash, or
  // the budgets already spent past what they allow.
  const tight =
    flow.cashCents < flow.billsDueCents ||
    (budget.totals.budgetedCents > 0 && budget.totals.leewayCents <= 0)
  return checkIdleCash({
    checkingCents: flow.cashCents,
    billsCents: flow.billsDueCents,
    dailySpendCents: daily,
    daysUntilPayday: flow.daysUntilPayday,
    nextPayday: flow.nextPayday,
    overdrawn: anyOverdrawn(accounts),
    tight,
  })
}
