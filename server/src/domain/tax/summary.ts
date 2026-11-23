// The year's totals at tax time: one line per category, the income lines
// (see income.ts), and money in that has no category yet. Pure.
//
// A transaction with no category is split by which way the money moved, as
// monthly totals do (see flowTotals in monthlyTotals.ts): money out is still
// spending, while money in stays apart from income, since nobody has said it
// is pay. Netting the two would hide a paycheck inside spending.

import type { Transaction } from '../transactions.js'
import { mayBeDeductible } from './classify.js'
import { incomeTotals, type PaySource } from './income.js'

export const MONEY_OUT_NOT_CATEGORIZED = 'Money out, not categorized'
export const MONEY_IN_NOT_CATEGORIZED = 'Money in, not categorized'
/** The summary's line for money in with no category that could be pay (see unfiledInCents). */
export const MONEY_IN_TO_CATEGORIZE = 'Possible income to categorize'

/** The category a counted transaction is filed under. Transfers never count, so none is one. */
export interface TaxRowCategory {
  id: string
  name: string
  group: string | null
  kind: 'expense' | 'income'
}

/** One counted transaction of the year, with its category, or null for none yet. */
export interface TaxRow {
  tx: Transaction
  category: TaxRowCategory | null
}

export interface TaxCategory {
  /** The category's id, or null for the two lines of money not categorized. */
  id: string | null
  name: string
  group: string | null
  kind: 'expense' | 'income' | null
  /** Whether the total is money in (an income category, or money in not categorized). */
  moneyIn: boolean
  /** Money out less refunds for spending; money in less money paid back for money in. */
  totalCents: number
  count: number
  mayBeDeductible: boolean
}

export interface TaxSummary {
  year: number
  /** Money in first, then spending; real categories before the uncategorized lines; largest first. */
  categories: TaxCategory[]
  /** Pay by who paid it, net of any paid back, largest first. Adds up to payCents. */
  income: PaySource[]
  /** Wages and other pay: money in under income categories that nothing marks as another kind. */
  payCents: number
  interestCents: number
  dividendsCents: number
  unemploymentCents: number
  socialSecurityCents: number
  /** Pensions and annuities. */
  retirementCents: number
  taxRefundCents: number
  /** Card rewards and cash back. */
  rewardsCents: number
  /**
   * Money in with no category that may be pay, interest or a refund, so it
   * counts on no line yet. Payments from people are left out: they are never pay.
   */
  unfiledInCents: number
}

// Keys for the two uncategorized lines. Category ids are uuids, so these never
// clash with one, and a category the owner named like one of them stays apart.
const UNFILED_OUT = 'unfiled:out'
const UNFILED_IN = 'unfiled:in'

/** The key of the line a row adds to: its category's id, or which way its money moved. */
export function rowKey({ tx, category }: TaxRow): string {
  if (category) return category.id
  return tx.amountCents < 0 ? UNFILED_IN : UNFILED_OUT
}

/** The key of a category line, matching rowKey for the rows that add to it. */
export function lineKey(line: Pick<TaxCategory, 'id' | 'moneyIn'>): string {
  if (line.id !== null) return line.id
  return line.moneyIn ? UNFILED_IN : UNFILED_OUT
}

/** The line a row adds to, before any row has. */
function emptyLine({ tx, category }: TaxRow): TaxCategory {
  if (category) {
    return {
      ...category,
      moneyIn: category.kind === 'income',
      totalCents: 0,
      count: 0,
      mayBeDeductible: category.kind === 'expense' && mayBeDeductible(category.name),
    }
  }
  const moneyIn = tx.amountCents < 0
  return {
    id: null,
    name: moneyIn ? MONEY_IN_NOT_CATEGORIZED : MONEY_OUT_NOT_CATEGORIZED,
    group: null,
    kind: null,
    moneyIn,
    totalCents: 0,
    count: 0,
    mayBeDeductible: false,
  }
}

/** Money in first, then categories before the uncategorized lines, then the largest total. */
function byPlace(a: TaxCategory, b: TaxCategory): number {
  const rank = (line: TaxCategory) => (line.moneyIn ? 0 : 2) + (line.id === null ? 1 : 0)
  return rank(a) - rank(b) || b.totalCents - a.totalCents
}

/** The category lines of the year, by key (see rowKey). */
function categoryLines(rows: TaxRow[]): Map<string, TaxCategory> {
  const lines = new Map<string, TaxCategory>()
  for (const row of rows) {
    const key = rowKey(row)
    const line = lines.get(key) ?? emptyLine(row)
    // Totals read positive in their own direction: money out for spending, money in for income.
    line.totalCents += line.moneyIn ? -row.tx.amountCents : row.tx.amountCents
    line.count += 1
    lines.set(key, line)
  }
  return lines
}

/** Money in with no category, less payments from people (see TaxSummary.unfiledInCents). */
function unfiledInCents(rows: TaxRow[]): number {
  return rows
    .filter(({ tx, category }) => category === null && tx.amountCents < 0 && !tx.person)
    .reduce((sum, { tx }) => sum - tx.amountCents, 0)
}

/** The year's summary from its counted rows. */
export function summarize(year: number, rows: TaxRow[]): TaxSummary {
  const lines = categoryLines(rows)
  const incomeRows = rows.filter((row) => row.category?.kind === 'income')
  const { sources, totals } = incomeTotals(incomeRows.map((row) => row.tx))
  return {
    year,
    categories: [...lines.values()].sort(byPlace),
    income: sources,
    payCents: totals.pay,
    interestCents: totals.interest,
    dividendsCents: totals.dividends,
    unemploymentCents: totals.unemployment,
    socialSecurityCents: totals.social_security,
    retirementCents: totals.retirement,
    taxRefundCents: totals.tax_refund,
    rewardsCents: totals.rewards,
    unfiledInCents: unfiledInCents(rows),
  }
}
