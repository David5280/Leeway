// Drill-downs for the budget's figures on Overview and Activity: what is left
// to spend, what has gone out, what has come in, where it went, and what
// still needs a category. Pure: each takes the budget (and its history, when
// there is one) and returns a DrillDown for DrillSheet to draw.

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

/**
 * What a whole period usually comes to: the average spent in the finished
 * periods that had spending. Null until one finished period has any, so the
 * Spent tile says something other than the hero's comparison.
 */
export function usualPeriodSpend(trends: Trends | undefined): number | null {
  const finished = (trends ?? []).filter((period) => period.offset < 0 && period.spentCents > 0)
  if (finished.length === 0) return null
  const total = finished.reduce((sum, period) => sum + period.spentCents, 0)
  return Math.round(total / finished.length)
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

/** Where the money went: every spending category, biggest first, the rest summed. */
export function categoriesDrill(budget: Budget, word: string, money: Money): DrillDown {
  const rows = spendingRows(budget)
  const listed = rows.slice(0, LISTED)
  const restCents = rows.slice(LISTED).reduce((sum, row) => sum + row.spentCents, 0)
  const terms: MathTerm[] = listed.map((row, index) => ({
    label: row.name,
    value: { cents: row.spentCents },
    op: index === 0 ? undefined : 'plus',
  }))
  if (restCents > 0)
    terms.push({ label: 'everything else', value: { cents: restCents }, op: 'plus' })
  const total = rows.reduce((sum, row) => sum + row.spentCents, 0)
  return {
    title: 'Where your money went',
    subtitle: `This ${word}, by category`,
    figure: { cents: total },
    math: {
      terms,
      result: { label: 'Spent by category', value: { cents: total } },
      note:
        budget.totals.uncategorizedCents > 0
          ? `${money(budget.totals.uncategorizedCents)} more still needs a category.`
          : undefined,
    },
    items: {
      title: 'Categories',
      rows: rows.map((row) => categoryItem(row, budgetDetail(row, money))),
    },
    more: { to: paths.spending(), label: 'Open budgets' },
  }
}

/** Money in: each income category that received something. */
export function incomeDrill(budget: Budget, word: string): DrillDown {
  const rows = budget.categories.filter((row) => row.kind === 'income' && row.spentCents !== 0)
  const usualCents = budget.previous.categories
    .filter((past) => rows.some((row) => row.categoryId === past.categoryId))
    .reduce((sum, past) => sum + past.spentToDateCents, 0)
  const terms: MathTerm[] =
    rows.length > 0
      ? rows.map((row, index) => ({
          label: row.name,
          value: { cents: row.spentCents },
          op: index === 0 ? undefined : 'plus',
        }))
      : [{ label: 'Nothing has come in yet', value: { cents: 0 } }]
  return {
    title: `Money in this ${word}`,
    figure: { cents: budget.totals.incomeCents, sign: 'change', tone: 'in' },
    math: {
      terms,
      result: {
        label: 'Money in',
        value: { cents: budget.totals.incomeCents, sign: 'change', tone: 'in' },
      },
      note: 'Only categories marked as income count. Transfers from your own accounts do not.',
    },
    usual:
      rows.length > 0
        ? {
            currentCents: budget.totals.incomeCents,
            usualCents,
            goodWhen: 'up',
            basis: `this point last ${word}`,
            subject: 'in',
          }
        : undefined,
    items:
      rows.length > 0 ? { title: 'Income', rows: rows.map((row) => categoryItem(row)) } : undefined,
    more: { to: paths.activity(), label: `See this ${word}'s transactions` },
  }
}

/** What still needs a category: a count and what it adds up to. */
export function uncategorizedDrill(budget: Budget): DrillDown {
  const { uncategorizedCount, uncategorizedCents } = budget.totals
  const word = uncategorizedCount === 1 ? 'transaction' : 'transactions'
  return {
    title: 'Needs a category',
    figure: { text: `${uncategorizedCount} ${word}` },
    math: {
      terms: [
        {
          label: `${uncategorizedCount} ${word} without a category`,
          value: { cents: uncategorizedCents },
        },
      ],
      result: { label: 'Spending not yet in a budget', value: { cents: uncategorizedCents } },
      note:
        uncategorizedCount > 0
          ? 'Until each has a category, it counts as spending but in no budget.'
          : 'Everything has a category.',
    },
    more:
      uncategorizedCount > 0
        ? {
            to: paths.activity({ category: 'uncategorized' }),
            label: `Sort ${uncategorizedCount} ${word}`,
          }
        : undefined,
  }
}
