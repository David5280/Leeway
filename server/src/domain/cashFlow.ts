// Safe to spend until the next paycheck: the one figure for what can be
// spent now. Every place that says what is safe to spend (the Overview's
// hero, Budgets, the widget, the check-in, the AI's summary, can-I-afford and
// the actions an assistant calls) reads it from getCashFlow, so none works
// out its own.
//
// It is the cash in checking (each account's available balance where the
// bank gives one, else its balance; never savings, investments or
// retirement), less the bills due before payday, less what an overdrawn
// account needs to get back to zero, and never below zero: what those
// outrun the cash by is the shortfall, a figure of its own.

import type { Db } from '../db/pool.js'
import { daysBetween, type IsoDate } from '../lib/dates.js'
import { paysBills } from './accountKinds.js'
import { listAccounts, type Account } from './accounts.js'
import { dueBefore, listBills, type Bill } from './bills.js'
import { paydayFrom, type Payday, type PaydaySource } from './pay/payday.js'
import { readCurrentPay } from './pay/source.js'
import type { Settings } from './settings.js'

export type { Payday, PaydaySource }

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
  /** True while the payday is projected from a single paycheck. */
  paydayEstimate: boolean
  /** A usual paycheck from the current employer, when paychecks were found. */
  expectedPayCents: number | null
  daysUntilPayday: number
  /** Whether any counted checking account has a balance: without one, the cash is unknown, not zero. */
  cashKnown: boolean
  /** Cash in counted checking accounts: available balance, else balance, each never below zero. */
  cashCents: number
  billsDue: BillDue[]
  billsDueCents: number
  /** What overdrawn checking accounts need to get back to zero. */
  overdraftCents: number
  /** Cash less the bills before payday and any overdraft, never below zero. */
  safeCents: number
  /** How far the bills and overdrafts outrun the cash; 0 when they fit or the cash is unknown. */
  shortfallCents: number
  /** Safe to spend per day until payday, counting today. */
  perDayCents: number
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

type CheckingAccount = Pick<Account, 'availableCents' | 'balanceCents'>

/**
 * What one checking account holds to spend, and what it needs to get back
 * to zero. Available balance comes first, since it already takes out pending
 * charges; an overdrawn account holds nothing to spend, and owes the lower of
 * its two balances back.
 */
export function checkingCash(account: CheckingAccount): {
  cashCents: number
  overdraftCents: number
} {
  const held = account.availableCents ?? account.balanceCents ?? 0
  const lowest = Math.min(account.balanceCents ?? held, held)
  return { cashCents: Math.max(0, held), overdraftCents: Math.max(0, -lowest) }
}

/** Safe to spend from checking, the bills before payday and the payday. Pure. */
export function safeToSpend(
  checking: CheckingAccount[],
  billsDue: BillDue[],
  payday: Payday,
  today: IsoDate,
): CashFlow {
  const each = checking.map(checkingCash)
  const cashCents = each.reduce((sum, account) => sum + account.cashCents, 0)
  const overdraftCents = each.reduce((sum, account) => sum + account.overdraftCents, 0)
  const billsDueCents = billsDue.reduce((sum, bill) => sum + bill.amountCents, 0)
  const cashKnown = checking.some(
    (account) => (account.availableCents ?? account.balanceCents) !== null,
  )
  const left = cashCents - billsDueCents - overdraftCents
  const safeCents = Math.max(0, left)
  const daysUntilPayday = daysBetween(today, payday.date)
  return {
    today,
    nextPayday: payday.date,
    paydaySource: payday.source,
    paydayEstimate: payday.estimate,
    expectedPayCents: payday.amountCents,
    daysUntilPayday,
    cashKnown,
    cashCents,
    billsDue,
    billsDueCents,
    overdraftCents,
    safeCents,
    // With no balance to go by, bills cannot be said to outrun it.
    shortfallCents: cashKnown ? Math.max(0, -left) : 0,
    // Today counts as a day to spend, so a payday tomorrow divides by one.
    perDayCents: Math.floor(safeCents / Math.max(1, daysUntilPayday)),
  }
}

/** The next payday, from the current employer's paychecks or the budget period. */
export async function nextPayday(db: Db, settings: Settings, today: IsoDate): Promise<Payday> {
  return paydayFrom(await readCurrentPay(db, settings, today), settings, today)
}

/** Safe to spend as of today, read fresh. */
export async function getCashFlow(db: Db, settings: Settings, today: IsoDate): Promise<CashFlow> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const payday = await nextPayday(db, settings, today)
  const bills = await listBills(db, today)
  const checking = (await listAccounts(db, false)).filter(paysBills)
  return safeToSpend(checking, billsBefore(bills, payday.date, today), payday, today)
}
