// "Can I afford this?": a purchase checked against what is safe to spend
// before payday (cashFlow.ts), the budget, and what goals hold back. Pure: the
// cash flow, budget and what can be spent now (spendable.ts) come in, nothing
// is read here. Its money a day is the hero's (spendable.perDayCents), before
// and after the purchase, so every surface quotes the same figure.

import type { BudgetSummary } from './budget.js'
import type { CashFlow } from './cashFlow.js'
import { dailyRoom, type Spendable } from './spendable.js'

export type Verdict = 'yes' | 'tight' | 'no'

export interface Affordability {
  verdict: Verdict
  /** Plain-language reasons, the deciding one first. */
  reasons: string[]
  amountCents: number
  /** Whether a checking balance was there to weigh it against; without one only the budget is weighed. */
  cashKnown: boolean
  /**
   * Cash left after the bills due by payday and any overdraft, once this is
   * bought: safe to spend less the purchase, negative when it does not fit;
   * null when the cash is unknown.
   */
  leftAfterBillsCents: number | null
  /** What goals set aside from the budget hold back this period. */
  goalsSetAsideCents: number
  /**
   * What can be spent a day, as the Overview's hero says it (the lesser of
   * the budget's room for the rest of the period and the cash's until
   * payday), before and once this is bought; never below zero.
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
  money: Money,
): Reason | null {
  if (leftAfterBills < 0) {
    return {
      level: 'no',
      text: `It would leave ${money(-leftAfterBills)} too little for the bills${cashFlow.overdraftCents > 0 ? ' and overdraft' : ''} due before payday on ${cashFlow.nextPayday}.`,
    }
  }
  if (leftAfterBills < budget.totals.setAsideCents) {
    return {
      level: 'tight',
      text: `It would dip into ${heldFor(budget, money)}.`,
    }
  }
  return null
}

/** Whether the purchase more than halves what can be spent a day. */
function squeezeReason(perDay: { before: number; after: number }, money: Money): Reason | null {
  if (perDay.after >= perDay.before * TIGHT_SHARE) return null
  return {
    level: 'tight',
    text: `What you can spend a day would drop from ${money(perDay.before)} to ${money(perDay.after)}.`,
  }
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

/** Said when there is no checking balance to weigh the purchase against. */
export const CASH_UNKNOWN_REASON =
  'Leeway has no checking balance yet, so this weighs the budget alone, not the cash.'

/** The one line for a purchase that fits. */
function fitsReason(room: Spendable, perDayAfter: number, money: Money): string {
  if (!room.cashKnown) return `It fits the budget. ${CASH_UNKNOWN_REASON}`
  return `It fits: you would still have about ${money(perDayAfter)} a day to spend.`
}

/**
 * Weighs a purchase three ways: whether the cash covers it and the bills due
 * by payday ("no" if not), whether it pushes a budget over or into what
 * goals hold back, and how much it squeezes what can be spent a day (either
 * of those makes it "tight"). With no checking balance the cash cannot be
 * weighed, so the budget alone decides, and the reasons say so.
 */
export function affordability(
  amountCents: number,
  { cashFlow, budget, room }: { cashFlow: CashFlow; budget: BudgetSummary; room: Spendable },
  categoryId: string | null,
  money: Money,
): Affordability {
  const cashKnown = cashFlow.cashKnown
  // Safe to spend, or below zero by the shortfall when the bills already do not fit.
  const leftAfterBills = cashFlow.safeCents - cashFlow.shortfallCents - amountCents
  const budgetRow = budgetRoom(budget, categoryId, amountCents)
  const perDay = {
    before: room.perDayCents,
    // The same day's room the hero reads, with the purchase taken off both sides.
    after: dailyRoom(
      budgetRow.budgetLeftCents === null
        ? null
        : { cents: budgetRow.budgetLeftCents, days: budget.period.daysLeft + 1 },
      cashKnown ? { cents: leftAfterBills, days: cashFlow.daysUntilPayday } : null,
    ),
  }
  const reasons = [
    cashKnown ? cashReason(cashFlow, budget, leftAfterBills, money) : null,
    budgetReason(budgetRow, budget, money),
    squeezeReason(perDay, money),
  ].filter((reason) => reason !== null)

  let verdict: Verdict = 'yes'
  if (reasons.length > 0) verdict = reasons.some((r) => r.level === 'no') ? 'no' : 'tight'
  const said = reasons.map((r) => r.text)
  return {
    verdict,
    reasons:
      verdict === 'yes'
        ? [fitsReason(room, perDay.after, money)]
        : [...said, ...(cashKnown ? [] : [CASH_UNKNOWN_REASON])],
    amountCents,
    cashKnown,
    leftAfterBillsCents: cashKnown ? leftAfterBills : null,
    goalsSetAsideCents: budget.totals.setAsideCents,
    perDayBeforeCents: perDay.before,
    perDayAfterCents: perDay.after,
    categoryLeftCents: budgetRow.categoryLeftCents,
    budgetLeftCents: budgetRow.budgetLeftCents,
  }
}
