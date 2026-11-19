// What counts toward totals. A transfer between the owner's own accounts
// (filed under a transfer category, which paired transfers always are; see
// transferPairs.ts) moves money without changing net worth, so it is never
// spending, income, a budget's progress, cash flow or a trend. Every total
// asks here, in SQL or in code, so they all agree.

import type { Category } from './categories.js'

/** A category's kind, or null for a transaction with no category yet. */
export type CountedKind = Category['kind'] | null

/** Whether transactions of this kind are only money moving between the owner's own accounts. */
export function isInternalTransfer(kind: CountedKind | undefined): boolean {
  return kind === 'transfer'
}

/** Whether transactions of this kind count toward spending, income and every other total. */
export function countsTowardTotals(kind: CountedKind | undefined): boolean {
  return !isInternalTransfer(kind)
}

/**
 * Whether a transaction counts as spending: an expense category, or none yet
 * (an uncategorized purchase is still money spent).
 */
export function countsAsSpending(kind: CountedKind | undefined): boolean {
  return kind === 'expense' || kind === null
}

/**
 * The SQL test for countsTowardTotals, given the alias of the categories
 * table joined to a transaction (LEFT JOIN, so uncategorized ones count).
 */
export function countedSql(alias = 'c'): string {
  return `(${alias}.kind IS NULL OR ${alias}.kind <> 'transfer')`
}

/** The SQL test for countsAsSpending, given the alias of the joined categories table. */
export function spendingSql(alias = 'c'): string {
  return `(${alias}.kind IS NULL OR ${alias}.kind = 'expense')`
}
