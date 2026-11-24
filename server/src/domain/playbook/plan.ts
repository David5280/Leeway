// The plan for the new paycheck: the bills due before the next payday, the
// set-asides, and what that leaves for everyday spending. Pure. Suggestions
// only: nothing here, or anywhere, moves money.
//
// Every figure is one Leeway already shows, so the plan can never disagree:
// the bills are the cash flow's bills before payday (cashFlow.ts), and the
// set-asides are the very list the budget's room holds back once (goals,
// trip budgets and sinking funds, setAsides in budgetReport.ts). Nothing is
// counted twice: a set-aside is never a bill, and the plan only lays them
// side by side.

import type { IsoDate } from '../../lib/dates.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import type { SetAside } from '../budget.js'
import type { BelowZero } from '../belowZero.js'
import type { BillDue } from '../cashFlow.js'

export type PlanLineKind = 'bill' | 'set_aside' | 'sinking_fund'

export interface PlanLine {
  kind: PlanLineKind
  name: string
  amountCents: number
  /** When a bill is due; null for a set-aside. */
  dueDate: IsoDate | null
  /** A bill whose date has passed unpaid. */
  overdue: boolean
}

/** When checking runs short before payday, as belowZero.ts finds it, without account names. */
export interface ShortNote {
  /** The first day checking is below zero. */
  date: IsoDate
  /** Already below zero today. */
  now: boolean
  shortCents: number
  /** A plain amount to move in, by a day, to cover it. */
  coverCents: number
  coverBy: IsoDate
  /** Whether a savings account holds enough to cover it. */
  savingsCanCover: boolean
}

export interface PaycheckPlan {
  /** The usual paycheck; null when no paychecks were found. */
  paycheckCents: number | null
  nextPayday: IsoDate
  lines: PlanLine[]
  billsCents: number
  setAsideCents: number
  /** The paycheck less the bills and set-asides: for everyday spending. Null without a paycheck. */
  leftCents: number | null
  /**
   * What can be spent now, the figure every screen leads with: the lesser of
   * the budget's room after set-asides and cash safe to spend (spendable.ts).
   */
  safeToSpendCents: number
  short: ShortNote | null
}

export interface PlanFacts {
  paycheckCents: number | null
  nextPayday: IsoDate
  billsDue: BillDue[]
  setAsides: SetAside[]
  /** The budget period's cadence, which each set-aside is a share of. */
  periodCadence: Cadence
  /** How often pay comes; null when not known. */
  payCadence: Cadence | null
  safeToSpendCents: number
  belowZero: BelowZero | null
}

const total = (lines: PlanLine[]) => lines.reduce((sum, line) => sum + line.amountCents, 0)

function billLine(bill: BillDue): PlanLine {
  return {
    kind: 'bill',
    name: bill.name,
    amountCents: bill.amountCents,
    dueDate: bill.dueDate,
    overdue: bill.overdue,
  }
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
    overdue: false,
  }
}

/** The short note without the account it would come from: names stay out of the plan. */
function shortNote(below: BelowZero | null): ShortNote | null {
  if (!below) return null
  return {
    date: below.date,
    now: below.now,
    shortCents: below.shortCents,
    coverCents: below.cover.amountCents,
    coverBy: below.cover.byDate,
    savingsCanCover: below.cover.fromAccountName !== null,
  }
}

/** The plan for the new paycheck. */
export function planPaycheck(facts: PlanFacts): PaycheckPlan {
  const bills = facts.billsDue.map(billLine)
  const held = facts.setAsides
    .filter((one) => one.amountCents > 0)
    .map((one) => setAsideLine(one, facts))
  const billsCents = total(bills)
  const setAsideCents = total(held)
  return {
    paycheckCents: facts.paycheckCents,
    nextPayday: facts.nextPayday,
    lines: [...bills, ...held],
    billsCents,
    setAsideCents,
    leftCents:
      facts.paycheckCents === null ? null : facts.paycheckCents - billsCents - setAsideCents,
    safeToSpendCents: facts.safeToSpendCents,
    short: shortNote(facts.belowZero),
  }
}
