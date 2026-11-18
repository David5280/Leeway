// "Can I afford this?": a purchase checked against cash until payday, the
// budget, and what goals hold back. Pure: the cash flow and budget come in,
// nothing is read here.

import type { BudgetSummary } from './budget.js'
import type { CashFlow } from './cashFlow.js'

export type Verdict = 'yes' | 'tight' | 'no'

export interface Affordability {
  verdict: Verdict
  /** Plain-language reasons, the deciding one first. */
  reasons: string[]
  amountCents: number
  /** Cash left after the bills due before payday, once this is bought. */
  leftAfterBillsCents: number
  /** What goals set aside from the budget hold back this period. */
  goalsSetAsideCents: number
  /**
   * What is left to spend per day until payday, after the bills and what goals
   * hold back, before and once this is bought; never below zero.
   */
  perDayBeforeCents: number
  perDayAfterCents: number
  /** The category's budget left once this is bought; null without a category budget. */
  categoryLeftCents: number | null
  /** All budgets' room left once this is bought and goals are set aside; null when nothing is budgeted. */
  budgetLeftCents: number | null
}

type Money = (cents: number) => string

/** Per-day room falling below this share of what it was counts as tight. */
const TIGHT_SHARE = 0.5

interface Reason {
  level: 'no' | 'tight'
  text: string
}

/** "the $115 set aside for Road bike", or "the $165 set aside for your goals" for several. */
function heldFor(budget: BudgetSummary, money: Money): string {
  const { setAsides } = budget
  const amount = money(budget.totals.setAsideCents)
  return setAsides.length === 1
    ? `the ${amount} set aside for ${setAsides[0]!.name}`
    : `the ${amount} set aside for your goals`
}

/** Whether the cash covers the purchase, the bills before payday and the goals, and how it squeezes each day. */
function cashReason(
  cashFlow: CashFlow,
  budget: BudgetSummary,
  leftAfterBills: number,
  perDay: { before: number; after: number },
  money: Money,
): Reason | null {
  if (leftAfterBills < 0) {
    return {
      level: 'no',
      text: `It would leave ${money(-leftAfterBills)} too little for the bills due before payday on ${cashFlow.nextPayday}.`,
    }
  }
  if (leftAfterBills < budget.totals.setAsideCents) {
    return {
      level: 'tight',
      text: `It would dip into ${heldFor(budget, money)}.`,
    }
  }
  if (perDay.after < perDay.before * TIGHT_SHARE) {
    return {
      level: 'tight',
      text: `Spending money until payday would drop from ${money(perDay.before)} to ${money(perDay.after)} a day.`,
    }
  }
  return null
}

/** The budget room left in the purchase's category and overall, once it is bought. */
function budgetRoom(budget: BudgetSummary, categoryId: string | null, amountCents: number) {
  const row = budget.categories.find((c) => c.categoryId === categoryId)
  // Spending only counts against the overall budget when its category has a budget.
  const budgeted = row !== undefined && row.leftCents !== null
  const counted = budgeted ? amountCents : 0
  const nothingBudgeted = budget.totals.budgetedCents === 0
  return {
    name: row?.name ?? '',
    categoryLeftCents: budgeted ? row.leftCents! - amountCents : null,
    /** Before goals are set aside, to tell a squeeze from goals apart from overspending. */
    beforeGoalsCents: nothingBudgeted ? null : budget.totals.leftCents - counted,
    budgetLeftCents: nothingBudgeted ? null : budget.totals.leewayCents - counted,
  }
}

function budgetReason(
  room: ReturnType<typeof budgetRoom>,
  budget: BudgetSummary,
  money: Money,
): Reason | null {
  if (room.categoryLeftCents !== null && room.categoryLeftCents < 0) {
    return {
      level: 'tight',
      text: `${room.name} would go ${money(-room.categoryLeftCents)} over budget this period.`,
    }
  }
  if (room.budgetLeftCents === null || room.budgetLeftCents >= 0) return null
  if (room.beforeGoalsCents! >= 0) {
    return {
      level: 'tight',
      text: `It fits the budgets only by using ${heldFor(budget, money)}.`,
    }
  }
  return {
    level: 'tight',
    text: `Budgets overall would go ${money(-room.beforeGoalsCents!)} over this period.`,
  }
}

/**
 * Weighs a purchase three ways: whether the cash covers it and the bills due
 * before payday ("no" if not), whether it pushes a budget over or into what
 * goals hold back, and how much it squeezes daily spending until payday
 * (either of those makes it "tight").
 */
export function affordability(
  amountCents: number,
  cashFlow: CashFlow,
  budget: BudgetSummary,
  categoryId: string | null,
  money: Money,
): Affordability {
  const days = Math.max(1, cashFlow.daysUntilPayday)
  const held = budget.totals.setAsideCents
  const leftAfterBillsCents = cashFlow.leftAfterBillsCents - amountCents
  // Money held for goals is not there to spend, so it comes off the daily figure.
  const perDay = (left: number) => Math.max(0, Math.floor((left - held) / days))
  const perDayBeforeCents = perDay(cashFlow.leftAfterBillsCents)
  const perDayAfterCents = perDay(leftAfterBillsCents)
  const room = budgetRoom(budget, categoryId, amountCents)
  const reasons = [
    cashReason(
      cashFlow,
      budget,
      leftAfterBillsCents,
      { before: perDayBeforeCents, after: perDayAfterCents },
      money,
    ),
    budgetReason(room, budget, money),
  ].filter((reason) => reason !== null)

  let verdict: Verdict = 'yes'
  if (reasons.length > 0) verdict = reasons.some((r) => r.level === 'no') ? 'no' : 'tight'
  return {
    verdict,
    reasons:
      verdict === 'yes'
        ? [
            `It fits: ${money(perDayAfterCents)} a day would be left until payday on ${cashFlow.nextPayday}.`,
          ]
        : reasons.map((r) => r.text),
    amountCents,
    leftAfterBillsCents,
    goalsSetAsideCents: held,
    perDayBeforeCents,
    perDayAfterCents,
    categoryLeftCents: room.categoryLeftCents,
    budgetLeftCents: room.budgetLeftCents,
  }
}
