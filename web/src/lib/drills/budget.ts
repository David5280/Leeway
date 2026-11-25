// Drill-downs for the budget's figures on Home and Activity: what is left to
// spend and what has gone out. Pure: each takes the budget (and its history,
// when there is one) and returns a DrillDown for DrillSheet to draw.

import type { Budget, CategoryBudget, Output } from '../../api/client'
import type { DrillDown, DrillItem, DrillTrend, DrillUsual, MathTerm } from '../drill'
import { paths } from '../../routes'

type Money = (cents: number) => string
type Trends = Output<'get_trends'>

/** How many categories a drill-down lists by name before "Everything else". */
const LISTED = 6

/** The budget categories that are spending, biggest first. */
function spendingRows(budget: Budget): CategoryBudget[] {
  return budget.categories
    .filter((row) => row.kind === 'expense' && row.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents)
}

/** A category as a row that opens its page, on the period `period` back (0 is now). */
export function categoryItem(row: CategoryBudget, detail?: string, period = 0): DrillItem {
  return {
    key: row.categoryId,
    label: row.name,
    detail,
    value: { cents: row.spentCents },
    to: paths.category(row.categoryId, period),
    icon: { category: { name: row.name, color: row.color, icon: row.icon, kind: row.kind } },
  }
}

/** A row's budget in words: "of $200, $36 left", "$12 over" or "no budget". */
export function budgetDetail(row: CategoryBudget, money: Money): string {
  if (row.budgetCents === null || row.leftCents === null) return 'No budget'
  if (row.leftCents < 0)
    return `Over its ${money(row.budgetCents)} budget by ${money(-row.leftCents)}`
  return `${money(row.leftCents)} left of ${money(row.budgetCents)}`
}

/** Spending each period, oldest first, as the trend's points. */
export function spendingTrend(trends: Trends | undefined, word: string): DrillTrend | undefined {
  if (!trends || trends.length < 2) return undefined
  return {
    points: trends.map((period) => ({ date: period.start, cents: period.spentCents })),
    label: `Spending each ${word}`,
    description: `What went out in each of the last ${trends.length} ${word}s, this one so far last.`,
  }
}

/** Left to spend: the budgets, less what they have spent and what goals hold back. */
export function leewayDrill(budget: Budget, money: Money): DrillDown {
  const { totals, period } = budget
  const terms: MathTerm[] = [
    { label: 'Budgets this period', value: { cents: totals.budgetedCents } },
    { label: 'spent in them', value: { cents: totals.budgetedSpentCents }, op: 'minus' },
  ]
  if (totals.setAsideCents > 0) {
    terms.push({
      label: 'set aside for goals',
      value: { cents: totals.setAsideCents },
      op: 'minus',
    })
  }
  const over = totals.leewayCents < 0
  const daysToSpend = period.daysLeft + 1
  const cashNote = period.offset === 0 ? budget.spendable?.note : null
  let note = 'Spending in categories without a budget is not counted here.'
  if (cashNote) note = `${cashNote} Spending without a budget is not counted in the budget.`
  else if (totals.safePerDayCents !== null && !over) {
    note = `That is about ${money(totals.safePerDayCents)} a day for the next ${daysToSpend} ${daysToSpend === 1 ? 'day' : 'days'}. Spending without a budget is not counted here.`
  }
  return {
    title: 'Left to spend',
    subtitle: `Day ${period.daysElapsed} of ${period.days}`,
    figure: { cents: totals.leewayCents, tone: over ? 'problem' : undefined },
    math: {
      terms,
      result: {
        label: over ? 'Over budget by' : 'Left to spend',
        value: { cents: Math.abs(totals.leewayCents), tone: over ? 'problem' : undefined },
      },
      note,
    },
    items: {
      title: 'Budgets',
      rows: budget.categories
        .filter((row) => row.kind === 'expense' && row.budgetCents !== null)
        .map((row) => categoryItem(row, budgetDetail(row, money))),
    },
    more: { to: paths.spending(), label: 'Open budgets' },
  }
}

/** Spending so far against the same point in the last period. */
export function spendingUsual(budget: Budget, word: string): DrillUsual {
  return {
    currentCents: budget.totals.spentCents,
    usualCents: budget.previous.spentToDateCents,
    goodWhen: 'down',
    basis: `this point last ${word}`,
    subject: 'spent',
  }
}

/** Spent this period: budgeted categories, the rest, and what still needs a category. */
export function spentDrill(budget: Budget, word: string, trends?: Trends): DrillDown {
  const { totals } = budget
  const otherCents = totals.spentCents - totals.budgetedSpentCents - totals.uncategorizedCents
  const terms: MathTerm[] = [
    { label: 'Categories with a budget', value: { cents: totals.budgetedSpentCents } },
    { label: 'categories without one', value: { cents: otherCents }, op: 'plus' },
  ]
  if (totals.uncategorizedCents !== 0) {
    terms.push({
      label: 'not yet sorted',
      value: { cents: totals.uncategorizedCents },
      op: 'plus',
    })
  }
  return {
    title: `Spent this ${word}`,
    subtitle: `Day ${budget.period.daysElapsed} of ${budget.period.days}`,
    figure: { cents: totals.spentCents },
    math: {
      terms,
      result: { label: 'Spent', value: { cents: totals.spentCents } },
      note: 'Refunds count against what they refund. Transfers between your accounts are left out.',
    },
    trend: spendingTrend(trends, word),
    usual: spendingUsual(budget, word),
    items: {
      title: 'Where it went',
      rows: spendingRows(budget)
        .slice(0, LISTED)
        .map((row) => categoryItem(row)),
    },
    more: { to: paths.activity(), label: `See this ${word}'s transactions` },
  }
}
