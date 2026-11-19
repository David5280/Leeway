// The Accounts dashboard from stored data: one or several accounts picked by
// the owner, with their balances, money in and out, spending by category,
// recent transactions, alerts and a summary.

import type { Db } from '../db/pool.js'
import { addDays } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { shiftPeriod, type Period } from '../lib/periods.js'
import { periodWord } from '../lib/words.js'
import type { AccountAlert } from './accountAlerts.js'
import { listAccounts, type Account } from './accounts.js'
import {
  accountsSummary,
  combineBalances,
  spendingByCategory,
  type CategorySpending,
  type CombinedBalances,
  type PeriodFlow,
} from './accountViewText.js'
import { alertsFor, recentCharges, selectAccounts } from './alerts.js'
import { categoryTotalsByRange, currentPeriod, type DateRange } from './budgetReport.js'
import { listCategories } from './categories.js'
import { countedSql } from './counted.js'
import { periodConfig, type Settings } from './settings.js'
import type { SummaryText } from './summaryText.js'
import { listTransactions, transactionFilterSchema, type Transaction } from './transactions.js'

/** Budget periods of money in and out shown, the current one included. */
export const FLOW_PERIODS = 4

/** Transactions listed, newest first. */
export const RECENT_COUNT = 8

export interface AccountsView {
  /** The accounts picked, in the usual order. */
  accounts: Account[]
  /** True when every account is picked, as when none was. */
  allAccounts: boolean
  /** The current budget period; `end` is its last day. */
  period: { start: string; end: string }
  balances: CombinedBalances
  /** Oldest first, ending with the current period so far. */
  flows: PeriodFlow[]
  /** This period, biggest first. */
  spending: CategorySpending[]
  recent: Transaction[]
  alerts: AccountAlert[]
  summary: SummaryText
}

/**
 * Money in and out of the accounts in each range, in one query, in the
 * ranges' order. Transfers are left out, so a card payment from checking is
 * not counted twice, along with excluded transactions and (if the owner says
 * so) pending ones.
 */
export async function moneyInAndOut(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
  accountIds: string[],
): Promise<{ inCents: number; outCents: number }[]> {
  const { rows } = await db.query<{ range: number; inCents: number; outCents: number }>(
    `SELECT r.n::int AS range,
       coalesce(sum(-t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS "inCents",
       coalesce(sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS "outCents"
     FROM unnest($1::date[], $2::date[]) WITH ORDINALITY AS r(start_date, end_date, n)
     JOIN transactions t ON t.date >= r.start_date AND t.date < r.end_date
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.account_id = ANY($4::uuid[]) AND NOT t.excluded
       AND ($3 OR NOT t.pending)
       AND ${countedSql()}
     GROUP BY r.n`,
    [ranges.map((r) => r.start), ranges.map((r) => r.end), includePending, accountIds],
  )
  // A range with no transactions has no row; WITH ORDINALITY counts from 1.
  return ranges.map((_, index) => {
    const row = rows.find((r) => r.range === index + 1)
    return { inCents: row?.inCents ?? 0, outCents: row?.outCents ?? 0 }
  })
}

/** The current period and the ones before it, oldest first. */
function recentPeriods(current: Period, settings: Settings): Period[] {
  const config = periodConfig(settings)
  return Array.from({ length: FLOW_PERIODS }, (_, index) =>
    shiftPeriod(current, index - (FLOW_PERIODS - 1), config),
  )
}

/**
 * The Accounts dashboard for the accounts picked by id, or for every account
 * when none are (see selectAccounts for ids that no longer match).
 */
export async function getAccountsView(
  db: Db,
  settings: Settings,
  now: Date,
  accountIds: string[],
): Promise<AccountsView> {
  const { period, today } = currentPeriod(settings, now)
  const allAccounts = await listAccounts(db)
  const accounts = selectAccounts(allAccounts, accountIds)
  const ids = accounts.map((a) => a.id)
  const periods = recentPeriods(period, settings)

  // With no accounts there is nothing to read; ANY of an empty list matches nothing anyway.
  const [flows, [totals], categories, recent, charges] = await Promise.all([
    moneyInAndOut(db, periods, settings.includePending, ids),
    categoryTotalsByRange(db, [period], settings.includePending, ids),
    listCategories(db),
    ids.length
      ? listTransactions(
          db,
          transactionFilterSchema.parse({ accountIds: ids, limit: RECENT_COUNT }),
        )
      : { transactions: [] },
    recentCharges(db, today),
  ])

  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  const balances = combineBalances(accounts)
  const spending = spendingByCategory(totals!, categories)
  const alerts = alertsFor(accounts, charges, settings)
  const periodFlows = periods.map((p, index) => ({
    start: p.start,
    end: addDays(p.end, -1),
    ...flows[index]!,
  }))
  return {
    accounts,
    allAccounts: accounts.length === allAccounts.length,
    period: { start: period.start, end: addDays(period.end, -1) },
    balances,
    flows: periodFlows,
    spending,
    recent: recent.transactions,
    alerts,
    summary: accountsSummary(
      {
        accounts,
        balances,
        flows: periodFlows,
        spending,
        alerts,
        periodWord: periodWord(settings.period.kind),
      },
      money,
    ),
  }
}
