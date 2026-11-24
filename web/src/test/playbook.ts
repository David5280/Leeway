// The payday playbook as get_payday_playbook returns it, built from a few
// plain facts: the budgets of the period that just closed, the ideas for
// what was left, and the new paycheck's lines. Every name and amount is
// made up.

import type { CloseOut, LeftoverSuggestion, PaycheckPlan, PlanLine, Playbook } from '../api/client'

/** The same day the Plan screen's tests are set on (planning.tsx). */
const TODAY = '2026-11-17'
export const LAST_PAYDAY = '2026-11-13'
export const NEXT_PAYDAY = '2026-11-27'

/** A flexible budget for the close-out: its name, budget and what was spent. */
export interface Budgeted {
  name: string
  budgetCents: number
  spentCents: number
}

/** Groceries and dining under budget by $44 in all. */
export const UNDER_BUDGET: Budgeted[] = [
  { name: 'Groceries', budgetCents: 20_000, spentCents: 16_000 },
  { name: 'Dining', budgetCents: 7_400, spentCents: 7_000 },
]

/** Dining over by enough that spending ran $36 over in all. */
export const OVER_BUDGET: Budgeted[] = [
  { name: 'Groceries', budgetCents: 20_000, spentCents: 19_000 },
  { name: 'Dining', budgetCents: 7_400, spentCents: 12_000 },
]

/**
 * The last pay period closed out from these budgets: Oct 30 to Nov 12, both
 * days included, as the server sends it, so it ends the day before payday.
 */
export function closeOutOf(budgets: Budgeted[]): CloseOut {
  const sum = (pick: (one: Budgeted) => number) => budgets.reduce((s, one) => s + pick(one), 0)
  const budgetedCents = sum((one) => one.budgetCents)
  const spentCents = sum((one) => one.spentCents)
  return {
    start: '2026-10-30',
    end: '2026-11-12',
    days: 14,
    budgetedCents,
    spentCents,
    leftoverCents: budgetedCents - spentCents,
    categories: budgets.map((one) => ({
      categoryId: `cat-${one.name.toLowerCase()}`,
      name: one.name,
      budgetCents: one.budgetCents,
      spentCents: one.spentCents,
      leftCents: one.budgetCents - one.spentCents,
    })),
  }
}

/** The emergency fund first, then a goal due in January, sharing out a $44 leftover. */
export const IDEAS: LeftoverSuggestion[] = [
  {
    kind: 'emergency_fund',
    label: 'Emergency fund',
    amountCents: 3_000,
    reason: 'Your emergency fund is short of its target.',
    targetDate: null,
  },
  {
    kind: 'goal',
    label: 'New laptop',
    amountCents: 1_400,
    reason: 'A goal still to reach.',
    targetDate: '2027-01-15',
  },
]

/** Rent and a phone bill before payday, a goal and a yearly cost set aside. */
export const LINES: PlanLine[] = [
  { kind: 'bill', name: 'Rent', amountCents: 120_000, dueDate: '2026-11-20', overdue: false },
  { kind: 'bill', name: 'Phone', amountCents: 6_000, dueDate: '2026-11-22', overdue: false },
  { kind: 'set_aside', name: 'New laptop', amountCents: 10_000, dueDate: null, overdue: false },
  {
    kind: 'sinking_fund',
    name: 'Car insurance',
    amountCents: 5_000,
    dueDate: null,
    overdue: false,
  },
]

/** The new paycheck's plan from these lines; a null paycheck while pay is unknown. */
export function planOf(
  lines: PlanLine[] = LINES,
  paycheckCents: number | null = 210_000,
  more: Partial<PaycheckPlan> = {},
): PaycheckPlan {
  const total = (bill: boolean) =>
    lines.filter((l) => (l.kind === 'bill') === bill).reduce((s, l) => s + l.amountCents, 0)
  const billsCents = total(true)
  const setAsideCents = total(false)
  return {
    paycheckCents,
    nextPayday: NEXT_PAYDAY,
    lines,
    billsCents,
    setAsideCents,
    leftCents: paycheckCents === null ? null : paycheckCents - billsCents - setAsideCents,
    safeToSpendCents: 45_000,
    short: null,
    ...more,
  }
}

/** Checking going below zero on Nov 24 before payday. */
export const SHORT: NonNullable<PaycheckPlan['short']> = {
  date: '2026-11-24',
  now: false,
  shortCents: 8_000,
  coverCents: 10_000,
  coverBy: '2026-11-23',
  savingsCanCover: true,
}

interface PlaybookFacts {
  budgets?: Budgeted[] | null
  ideas?: LeftoverSuggestion[]
  plan?: PaycheckPlan
  justPaid?: boolean
  paydayEstimate?: boolean
  /** The day it is read, for a notice in the few days after payday. */
  today?: string
}

/** The playbook from these facts; budgets null means no pay schedule is known. */
export function playbookOf({
  budgets = UNDER_BUDGET,
  ideas = [],
  plan = planOf(),
  justPaid = false,
  paydayEstimate = false,
  today = TODAY,
}: PlaybookFacts = {}): Playbook {
  return {
    today,
    lastPayday: budgets ? LAST_PAYDAY : null,
    justPaid,
    nextPayday: NEXT_PAYDAY,
    paydaySource: 'pay_period',
    paydayEstimate,
    closeOut: budgets ? closeOutOf(budgets) : null,
    suggestions: ideas,
    plan,
  }
}
