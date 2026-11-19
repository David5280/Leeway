// Cash flow until the next paycheck: the cash on hand, the bills still due
// before payday, and what that leaves to spend each day.

import type { Db } from '../db/pool.js'
import { daysBetween, type IsoDate } from '../lib/dates.js'
import { periodContaining, type Cadence } from '../lib/periods.js'
import { dueBefore, listBills, type Bill } from './bills.js'
import { detectRecurring, recentHistory } from './recurring.js'
import { periodConfig, type Settings } from './settings.js'

/** Where the payday came from, so the app and an agent can say how sure it is. */
export type PaydaySource = 'pay_period' | 'detected_income' | 'period_end'

export interface BillDue {
  billId: string
  name: string
  dueDate: IsoDate
  amountCents: number
  overdue: boolean
}

export interface CashFlow {
  today: IsoDate
  nextPayday: IsoDate
  paydaySource: PaydaySource
  /** The paycheck detected from history, when that is where the payday came from. */
  expectedPayCents: number | null
  daysUntilPayday: number
  /** Available balance (or balance) across counted checking and savings accounts. */
  cashCents: number
  billsDue: BillDue[]
  billsDueCents: number
  /** Cash minus the bills due before payday. Negative means the bills do not fit. */
  leftAfterBillsCents: number
  /** What is left per day until payday, counting today; never below zero. */
  perDayCents: number
}

export interface Payday {
  date: IsoDate
  source: PaydaySource
  amountCents: number | null
  /** How often pay comes, when the pay period or a regular deposit says. */
  cadence: Cadence | null
}

/** A paycheck budget period's frequency, as a cadence. */
const PAY_CADENCE: Record<'weekly' | 'biweekly' | 'semimonthly' | 'monthly', Cadence> = {
  weekly: 'week',
  biweekly: 'biweek',
  semimonthly: 'semimonth',
  monthly: 'month',
}

/**
 * The next payday. A paycheck budget period knows it exactly. Otherwise the
 * largest regular deposit in history is taken as pay, and failing that the
 * end of the budget period stands in.
 */
export async function nextPayday(db: Db, settings: Settings, today: IsoDate): Promise<Payday> {
  const config = periodConfig(settings)
  // `end` is exclusive: it is already the first day of the next period.
  const nextPeriodStart = periodContaining(today, config).end
  if (config.kind === 'paycheck') {
    return {
      date: nextPeriodStart,
      source: 'pay_period',
      amountCents: null,
      cadence: PAY_CADENCE[config.frequency],
    }
  }

  const income = detectRecurring(await recentHistory(db, today), today)
    .filter((s) => s.direction === 'in' && s.nextDate > today)
    .sort((a, b) => b.typicalAmountCents - a.typicalAmountCents)[0]
  if (income) {
    return {
      date: income.nextDate,
      source: 'detected_income',
      amountCents: income.typicalAmountCents,
      cadence: income.cadence,
    }
  }
  return { date: nextPeriodStart, source: 'period_end', amountCents: null, cadence: null }
}

/** Every unpaid bill date before payday, soonest first. */
function billsBefore(bills: Bill[], payday: IsoDate, today: IsoDate): BillDue[] {
  return bills
    .flatMap((bill) =>
      dueBefore(bill, payday).map((dueDate) => ({
        billId: bill.id,
        name: bill.name,
        dueDate,
        amountCents: bill.amountCents,
        overdue: dueDate < today,
      })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
}

async function cashOnHand(db: Db): Promise<number> {
  const { rows } = await db.query<{ cents: number }>(
    `SELECT coalesce(sum(coalesce(available_cents, balance_cents)), 0)::bigint AS cents
     FROM accounts WHERE type = 'depository' AND NOT hidden`,
  )
  return rows[0]!.cents
}

export async function getCashFlow(db: Db, settings: Settings, today: IsoDate): Promise<CashFlow> {
  const payday = await nextPayday(db, settings, today)
  const billsDue = billsBefore(await listBills(db, today), payday.date, today)
  const billsDueCents = billsDue.reduce((sum, bill) => sum + bill.amountCents, 0)
  const cashCents = await cashOnHand(db)
  const leftAfterBillsCents = cashCents - billsDueCents
  const daysUntilPayday = daysBetween(today, payday.date)
  return {
    today,
    nextPayday: payday.date,
    paydaySource: payday.source,
    expectedPayCents: payday.amountCents,
    daysUntilPayday,
    cashCents,
    billsDue,
    billsDueCents,
    leftAfterBillsCents,
    // Today counts as a day to spend, so a payday tomorrow divides by one.
    perDayCents: Math.max(0, Math.floor(leftAfterBillsCents / Math.max(1, daysUntilPayday))),
  }
}
