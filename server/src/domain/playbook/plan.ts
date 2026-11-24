// The plan for the new paycheck: every bill due in this pay period, the
// set-asides, and what that leaves for everyday spending. Pure. Suggestions
// only: nothing here, or anywhere, moves money.
//
// The figure must hold still for the whole pay period, so the bills are all
// those due from the latest payday up to the next, paid or not: rent paying
// mid-period changes nothing. What checking still has to cover before
// payday is the cash flow's question (cashFlow.ts), quoted here only as safe
// to spend. The set-asides are the very list the budget's room holds back
// (goals, trip budgets and sinking funds, setAsides in budgetReport.ts).
// Nothing is counted twice: a set-aside is never a bill.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import { occurrences } from '../../lib/schedule.js'
import type { Bill } from '../bills.js'
import type { SetAside } from '../budget.js'

export type PlanLineKind = 'bill' | 'set_aside' | 'sinking_fund'

export interface PlanLine {
  kind: PlanLineKind
  name: string
  amountCents: number
  /** When a bill is due; null for a set-aside. */
  dueDate: IsoDate | null
  /** A bill already paid for this due date. */
  paid: boolean
  /** A bill whose date has passed unpaid. */
  overdue: boolean
}

export interface PaycheckPlan {
  /** The usual paycheck; null when no paychecks were found. */
  paycheckCents: number | null
  /** The pay period's first day: the latest payday, or today while no pay schedule is known. */
  periodStart: IsoDate
  /** The next payday, the first day of the next pay period. */
  nextPayday: IsoDate
  lines: PlanLine[]
  /** Every bill due in the pay period, paid or not. */
  billsCents: number
  setAsideCents: number
  /**
   * The paycheck less the pay period's bills and the set-asides, left for
   * everyday spending. It stays put all period. Null without a paycheck.
   */
  everydayCents: number | null
  /**
   * What can be spent now, the figure every screen leads with: the lesser of
   * the budget's room after set-asides and cash safe to spend (spendable.ts).
   */
  safeToSpendCents: number
}

export interface PlanFacts {
  paycheckCents: number | null
  periodStart: IsoDate
  nextPayday: IsoDate
  today: IsoDate
  bills: Bill[]
  setAsides: SetAside[]
  /** The budget period's cadence, which each set-aside is a share of. */
  periodCadence: Cadence
  /** How often pay comes; null when not known. */
  payCadence: Cadence | null
  safeToSpendCents: number
}

const total = (lines: PlanLine[]) => lines.reduce((sum, line) => sum + line.amountCents, 0)

/**
 * Every due date of every bill from `start` up to, not including, the next
 * payday, soonest first. A bill due on payday belongs to the paycheck that
 * lands that day. Dates before the bill's first due date (its anchor) never
 * count. A date before the bill's next unpaid one is paid (scheduleOf).
 */
export function periodBills(bills: Bill[], start: IsoDate, payday: IsoDate, today: IsoDate) {
  return bills
    .flatMap((bill) =>
      occurrences(bill.anchorDate, bill.cadence, start, addDays(payday, -1))
        .filter((dueDate) => dueDate >= bill.anchorDate)
        .map((dueDate): PlanLine => {
          const paid = dueDate < bill.nextDueDate
          return {
            kind: 'bill',
            name: bill.name,
            amountCents: bill.amountCents,
            dueDate,
            paid,
            overdue: !paid && dueDate < today,
          }
        }),
    )
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.name.localeCompare(b.name))
}

/**
 * A set-aside as one paycheck's share. With a paycheck budget period that is
 * its figure exactly; with another period it is the same share, spread to
 * how often pay comes, so a month's share is not taken from every paycheck.
 */
function setAsideLine(held: SetAside, facts: PlanFacts): PlanLine {
  const to = facts.payCadence ?? facts.periodCadence
  return {
    kind: held.kind === 'sinking_fund' ? 'sinking_fund' : 'set_aside',
    name: held.name,
    amountCents: convertCadence(held.amountCents, facts.periodCadence, to),
    dueDate: null,
    paid: false,
    overdue: false,
  }
}

/** The plan for the new paycheck. */
export function planPaycheck(facts: PlanFacts): PaycheckPlan {
  const bills = periodBills(facts.bills, facts.periodStart, facts.nextPayday, facts.today)
  const held = facts.setAsides
    .filter((one) => one.amountCents > 0)
    .map((one) => setAsideLine(one, facts))
  const billsCents = total(bills)
  const setAsideCents = total(held)
  return {
    paycheckCents: facts.paycheckCents,
    periodStart: facts.periodStart,
    nextPayday: facts.nextPayday,
    lines: [...bills, ...held],
    billsCents,
    setAsideCents,
    everydayCents:
      facts.paycheckCents === null ? null : facts.paycheckCents - billsCents - setAsideCents,
    safeToSpendCents: facts.safeToSpendCents,
  }
}
