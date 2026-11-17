// "Can I afford this?": a purchase checked against cash until payday and the budget.
// Pure: the cash flow and budget come in, nothing is read here.

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
  /** What is left to spend per day until payday, once this is bought; never below zero. */
  perDayBeforeCents: number
  perDayAfterCents: number
  /** The category's budget left once this is bought; null without a category budget. */
  categoryLeftCents: number | null
  /** All budgets' room left once this is bought; null when nothing is budgeted. */
  budgetLeftCents: number | null
}

type Money = (cents: number) => string

/** Per-day room falling below this share of what it was counts as tight. */
const TIGHT_SHARE = 0.5

interface Reason {
  level: 'no' | 'tight'
  text: string
}

/** Whether the cash covers the purchase and the bills before payday, and how it squeezes each day. */
function cashReason(
  cashFlow: CashFlow,
  leftAfterBills: number,
  perDayAfter: number,
  money: Money,
): Reason | null {
  if (leftAfterBills < 0) {
    return {
      level: 'no',
      text: `It would leave ${money(-leftAfterBills)} too little for the bills due before payday on ${cashFlow.nextPayday}.`,
    }
  }
  if (perDayAfter < cashFlow.perDayCents * TIGHT_SHARE) {
    return {
      level: 'tight',
      text: `Spending money until payday would drop from ${money(cashFlow.perDayCents)} to ${money(perDayAfter)} a day.`,
    }
  }
  return null
}

/** The budget room left in the purchase's category and overall, once it is bought. */
function budgetRoom(budget: BudgetSummary, categoryId: string | null, amountCents: number) {
  const row = budget.categories.find((c) => c.categoryId === categoryId)
  // Spending only counts against the overall budget when its category has a budget.
  const budgeted = row !== undefined && row.leftCents !== null
  return {
    name: row?.name ?? '',
    categoryLeftCents: budgeted ? row.leftCents! - amountCents : null,
    budgetLeftCents:
      budget.totals.budgetedCents === 0
        ? null
        : budget.totals.leftCents - (budgeted ? amountCents : 0),
  }
}

function budgetReason(room: ReturnType<typeof budgetRoom>, money: Money): Reason | null {
  if (room.categoryLeftCents !== null && room.categoryLeftCents < 0) {
    return {
      level: 'tight',
      text: `${room.name} would go ${money(-room.categoryLeftCents)} over budget this period.`,
    }
  }
  if (room.budgetLeftCents !== null && room.budgetLeftCents < 0) {
    return {
      level: 'tight',
      text: `Budgets overall would go ${money(-room.budgetLeftCents)} over this period.`,
    }
  }
  return null
}

/**
 * Weighs a purchase three ways: whether the cash covers it and the bills due
 * before payday ("no" if not), whether it pushes a budget over, and how much it
 * squeezes daily spending until payday (either makes it "tight").
 */
export function affordability(
  amountCents: number,
  cashFlow: CashFlow,
  budget: BudgetSummary,
  categoryId: string | null,
  money: Money,
): Affordability {
  const days = Math.max(1, cashFlow.daysUntilPayday)
  const leftAfterBillsCents = cashFlow.leftAfterBillsCents - amountCents
  const perDayAfterCents = Math.max(0, Math.floor(leftAfterBillsCents / days))
  const room = budgetRoom(budget, categoryId, amountCents)
  const reasons = [
    cashReason(cashFlow, leftAfterBillsCents, perDayAfterCents, money),
    budgetReason(room, money),
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
    perDayBeforeCents: cashFlow.perDayCents,
    perDayAfterCents,
    categoryLeftCents: room.categoryLeftCents,
    budgetLeftCents: room.budgetLeftCents,
  }
}
