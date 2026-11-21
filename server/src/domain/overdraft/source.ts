// The overdraft forecast from stored data: each checking account's balance,
// the bills paid from it, its usual day-to-day spending and the next
// payday, handed to forecast.ts to walk forward.

import type { Db } from '../../db/pool.js'
import { addDays, daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'
import { occurrences } from '../../lib/schedule.js'
import { kindOf, paysBills } from '../accountKinds.js'
import { isCounted } from '../accountSharing.js'
import { listAccounts, type Account } from '../accounts.js'
import { dueBefore, listBills, type Bill } from '../bills.js'
import { nextPayday } from '../cashFlow.js'
import type { Settings } from '../settings.js'
import { CARD_PAYMENT_CODE } from '../transfers.js'
import { forecastAccounts, type AccountForecast, type ForecastInput } from './forecast.js'

/** How far back usual spending is read: eight weeks, so one odd week moves it little. */
export const SPENDING_DAYS = 56

/** Usual spending is never read from fewer days than this, so a new account's first big week does not alarm. */
const MIN_SPENDING_DAYS = 14

export interface OverdraftForecast {
  payday: IsoDate
  paydayEstimate: boolean
  accounts: AccountForecast[]
}

/** Money out of one account lately, and the first day it shows any. */
interface Outflow {
  accountId: string
  cents: number
  firstDate: IsoDate
}

/**
 * Money out of each account over the last SPENDING_DAYS days, before today:
 * spending, bills and card or loan payments, but not money moved to the
 * owner's other accounts, which they choose day to day.
 */
async function recentOutflows(db: Db, today: IsoDate): Promise<Outflow[]> {
  const { rows } = await db.query<Outflow>(
    `SELECT t.account_id AS "accountId", sum(t.amount_cents)::bigint::int AS cents,
       min(t.date) AS "firstDate"
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.amount_cents > 0 AND NOT t.excluded AND NOT t.pending
       AND t.date >= $1 AND t.date < $2
       AND (c.kind IS NULL OR c.kind <> 'transfer'
         OR t.provider_category_detailed = '${CARD_PAYMENT_CODE}'
         OR t.provider_category_primary = 'LOAN_PAYMENTS')
     GROUP BY t.account_id`,
    [addDays(today, -SPENDING_DAYS), today],
  )
  return rows
}

/**
 * The checking account a bill comes out of: its own, when it is a checking
 * account; none when it is paid from a card or savings, which leaves
 * checking alone until the card is paid; else the main checking account.
 */
function payingAccount(bill: Bill, checkingIds: Set<string>, mainId: string): string | null {
  if (bill.accountId === null) return mainId
  return checkingIds.has(bill.accountId) ? bill.accountId : null
}

/** What an account holds now: the lower of its balances, so an overdraft shows. Null when unknown. */
function heldNow(account: Account): number | null {
  const known = [account.availableCents, account.balanceCents].filter((c) => c !== null)
  return known.length ? Math.min(...known) : null
}

/**
 * How many of a bill's payments fall in a window: its due dates there, or
 * one when it was paid there early, before a due date the window misses.
 */
function paymentsIn(bill: Bill, from: IsoDate, to: IsoDate): number {
  const due = occurrences(bill.anchorDate, bill.cadence, from, to).length
  const paidThen =
    bill.lastPaidDate !== null && bill.lastPaidDate >= from && bill.lastPaidDate <= to
  return Math.max(due, paidThen ? 1 : 0)
}

/**
 * Usual day-to-day spending a day: money out lately less the bills paid then
 * (they are counted on their own due dates instead), over the days the
 * account has history for.
 */
function dailySpend(outflow: Outflow | undefined, bills: Bill[], today: IsoDate): number {
  if (!outflow) return 0
  const from = maxDate(addDays(today, -SPENDING_DAYS), outflow.firstDate)
  const yesterday = addDays(today, -1)
  const billsCents = bills
    .map((bill) => paymentsIn(bill, from, yesterday) * bill.amountCents)
    .reduce((sum, cents) => sum + cents, 0)
  const days = Math.max(MIN_SPENDING_DAYS, daysBetween(from, today))
  return Math.max(0, Math.round((outflow.cents - billsCents) / days))
}

/** Each checking account's forecast to the next payday, read fresh. */
export async function readOverdraftForecast(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<OverdraftForecast> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const payday = await nextPayday(db, settings, today)
  const accounts = (await listAccounts(db, false)).filter(isCounted)
  const bills = await listBills(db, today)
  const outflows = new Map((await recentOutflows(db, today)).map((o) => [o.accountId, o]))
  const checking = accounts.filter((account) => paysBills(account) && heldNow(account) !== null)
  const empty = { payday: payday.date, paydayEstimate: payday.estimate, accounts: [] }
  if (checking.length === 0) return empty
  // The main account, which bills with no account of their own come out of: the busiest one.
  const main = [...checking].sort(
    (a, b) => (outflows.get(b.id)?.cents ?? 0) - (outflows.get(a.id)?.cents ?? 0),
  )[0]!
  const checkingIds = new Set(checking.map((account) => account.id))
  const inputs = checking.map((account): ForecastInput => {
    const own = bills.filter((bill) => payingAccount(bill, checkingIds, main.id) === account.id)
    return {
      accountId: account.id,
      accountName: account.name,
      startCents: heldNow(account)!,
      dailySpendCents: dailySpend(outflows.get(account.id), own, today),
      bills: own.flatMap((bill) =>
        dueBefore(bill, addDays(payday.date, 1)).map((dueDate) => ({
          name: bill.name,
          dueDate,
          amountCents: bill.amountCents,
        })),
      ),
    }
  })
  const savings = accounts
    .filter((account) => account.type === 'depository' && kindOf(account) === 'savings')
    .map((account) => ({
      accountId: account.id,
      accountName: account.name,
      spareCents: Math.max(0, heldNow(account) ?? 0),
    }))
  return { ...empty, accounts: forecastAccounts(inputs, savings, today, payday.date) }
}
