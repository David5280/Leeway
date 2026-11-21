// A year's money for tax time: every counted transaction as a CSV grouped by
// category with a total for each, and a short summary. Categories that often
// matter on a return (health, giving, education, childcare, work costs) are
// flagged as may be deductible, for the owner to check with a tax pro. Pay is
// listed by who paid it, apart from payments between people and transfers
// between the owner's own accounts, with interest and dividends on their own.
// This is a summary of what happened, not tax advice.

import type { Db } from '../db/pool.js'
import { makeDate } from '../lib/dates.js'
import { countedSql } from './counted.js'
import { transactionsByIds, type Transaction } from './transactions.js'

/** Category names that often matter on a return. */
const DEDUCTIBLE_NAMES =
  /\b(health|medical|dental|doctor|pharmac\w*|vision|charit\w*|donations?|giving|education|tuition|school|child ?care|daycare|business|office|work)\b/i

export const MAY_BE_DEDUCTIBLE = 'May be deductible, check with a tax pro'

export interface TaxCategory {
  name: string
  group: string | null
  kind: 'expense' | 'income' | null
  /** Money out less refunds for spending; money in for income (positive). */
  totalCents: number
  count: number
  mayBeDeductible: boolean
}

export interface TaxSummary {
  year: number
  categories: TaxCategory[]
  /** Pay by who paid it, largest first. */
  income: { source: string; cents: number }[]
  payCents: number
  interestCents: number
  dividendsCents: number
}

export interface TaxExport {
  filename: string
  csv: string
  summary: TaxSummary
}

interface Row {
  id: string
  category: string | null
  grp: string | null
  kind: 'expense' | 'income' | null
}

/** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

/** What kind of money in a transaction is, for the income lines. */
function incomeLine(tx: Transaction, category: string): 'interest' | 'dividends' | 'pay' | null {
  const code = tx.bankCategory ?? ''
  if (code === 'INCOME_INTEREST_EARNED') return 'interest'
  if (code === 'INCOME_DIVIDENDS') return 'dividends'
  // A payment from a person (Zelle, Venmo) is not pay.
  if (tx.person || /^received from/i.test(category)) return null
  return 'pay'
}

function summarize(year: number, rows: Row[], byId: Map<string, Transaction>): TaxSummary {
  const categories = new Map<string, TaxCategory>()
  const sources = new Map<string, number>()
  const totals = { pay: 0, interest: 0, dividends: 0 }
  for (const row of rows) {
    const tx = byId.get(row.id)!
    const name = row.category ?? 'Not categorized'
    const sign = row.kind === 'income' ? -1 : 1
    const category = categories.get(name) ?? {
      name,
      group: row.grp,
      kind: row.kind,
      totalCents: 0,
      count: 0,
      mayBeDeductible: row.kind === 'expense' && DEDUCTIBLE_NAMES.test(name),
    }
    category.totalCents += sign * tx.amountCents
    category.count += 1
    categories.set(name, category)
    if (row.kind !== 'income') continue
    const line = incomeLine(tx, name)
    if (!line) continue
    totals[line] -= tx.amountCents
    if (line === 'pay')
      sources.set(tx.displayName, (sources.get(tx.displayName) ?? 0) - tx.amountCents)
  }
  return {
    year,
    categories: [...categories.values()].sort(
      (a, b) =>
        (a.kind === 'income' ? 0 : 1) - (b.kind === 'income' ? 0 : 1) ||
        b.totalCents - a.totalCents,
    ),
    income: [...sources]
      .map(([source, cents]) => ({ source, cents }))
      .filter((line) => line.cents > 0)
      .sort((a, b) => b.cents - a.cents),
    payCents: totals.pay,
    interestCents: totals.interest,
    dividendsCents: totals.dividends,
  }
}

/** The CSV: a header, then each category's transactions and its total line. */
function csvOf(summary: TaxSummary, rows: Row[], byId: Map<string, Transaction>): string {
  const lines = [['Category', 'Group', 'Date', 'Name', 'Account', 'Amount', 'Note'].join(',')]
  const byCategory = new Map<string, Row[]>()
  for (const row of rows) {
    const name = row.category ?? 'Not categorized'
    if (!byCategory.has(name)) byCategory.set(name, [])
    byCategory.get(name)!.push(row)
  }
  for (const category of summary.categories) {
    const sign = category.kind === 'income' ? -1 : 1
    for (const row of byCategory.get(category.name)!) {
      const tx = byId.get(row.id)!
      lines.push(
        [
          csvCell(category.name),
          csvCell(category.group ?? ''),
          tx.date,
          csvCell(tx.displayName),
          csvCell(tx.accountName),
          dollars(sign * tx.amountCents),
          csvCell(tx.note ?? ''),
        ].join(','),
      )
    }
    const flag = category.mayBeDeductible ? csvCell(MAY_BE_DEDUCTIBLE) : ''
    lines.push(
      [csvCell(`Total: ${category.name}`), '', '', '', '', dollars(category.totalCents), flag].join(
        ',',
      ),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

/** The year's export. Excluded transactions, hidden accounts and transfers are left out. */
export async function taxExport(db: Db, year: number): Promise<TaxExport> {
  const { rows } = await db.query<Row>(
    `SELECT t.id, c.name AS category, c.group_name AS grp,
       CASE WHEN c.kind = 'income' THEN 'income' WHEN c.kind = 'expense' THEN 'expense' END AS kind
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date <= $2 AND NOT t.excluded AND NOT a.hidden AND NOT t.pending
       AND ${countedSql('c')}
     ORDER BY c.name NULLS LAST, t.date, t.id`,
    [makeDate(year, 1, 1), makeDate(year, 12, 31)],
  )
  const byId = new Map(
    (
      await transactionsByIds(
        db,
        rows.map((row) => row.id),
      )
    ).map((tx) => [tx.id, tx]),
  )
  const summary = summarize(year, rows, byId)
  return { filename: `leeway-${year}-tax-summary.csv`, csv: csvOf(summary, rows, byId), summary }
}
