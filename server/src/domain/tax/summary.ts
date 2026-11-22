// The year's totals at tax time: one line per category, pay by who paid it,
// interest, dividends, and money in that has no category yet. Pure.
//
// A transaction with no category is split by which way the money moved, as
// monthly totals do (see flowTotals in monthlyTotals.ts): money out is still
// spending, while money in stays apart from income, since nobody has said it
// is pay. Netting the two would hide a paycheck inside spending.

import type { Transaction } from '../transactions.js'
import { incomeLine, mayBeDeductible } from './classify.js'

export const NOT_CATEGORIZED = 'Not categorized'
export const MONEY_IN_NOT_CATEGORIZED = 'Money in, not categorized'

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
  income: { source: string; cents: number }[]
  payCents: number
  interestCents: number
  dividendsCents: number
  /** Money in with no category: counted as pay only once it is categorized as income. */
  unfiledInCents: number
}

// Keys for the two uncategorized lines. Category ids are uuids, so these never
// clash with one, and a category the owner named "Not categorized" stays apart.
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
    name: moneyIn ? MONEY_IN_NOT_CATEGORIZED : NOT_CATEGORIZED,
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

/** Pay by source, interest and dividends, from the rows filed under income categories. */
function incomeTotals(rows: TaxRow[]) {
  const sources = new Map<string, number>()
  const totals = { pay: 0, interest: 0, dividends: 0 }
  for (const row of rows) {
    if (row.category?.kind !== 'income') continue
    const line = incomeLine(row.tx)
    if (line === 'person' || line === 'moved_in') continue
    const cents = -row.tx.amountCents
    totals[line] += cents
    if (line === 'pay')
      sources.set(row.tx.displayName, (sources.get(row.tx.displayName) ?? 0) + cents)
  }
  // Each source's net, money paid back included, so the sources add up to Pay.
  const income = [...sources]
    .map(([source, cents]) => ({ source, cents }))
    .filter((source) => source.cents !== 0)
    .sort((a, b) => b.cents - a.cents)
  return { income, ...totals }
}

/** The year's summary from its counted rows. */
export function summarize(year: number, rows: TaxRow[]): TaxSummary {
  const lines = categoryLines(rows)
  const { income, pay, interest, dividends } = incomeTotals(rows)
  return {
    year,
    categories: [...lines.values()].sort(byPlace),
    income,
    payCents: pay,
    interestCents: interest,
    dividendsCents: dividends,
    unfiledInCents: lines.get(UNFILED_IN)?.totalCents ?? 0,
  }
}
