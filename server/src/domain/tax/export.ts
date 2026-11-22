// A year's money for tax time: every counted transaction as a CSV grouped by
// category with a total for each, and a summary. Categories that often matter
// on a return are flagged as may be deductible, for the owner to check with a
// tax pro (see classify.ts). This is a summary of what happened, not tax advice.
//
// Every account counts, hidden ones too: the money really moved that year,
// and someone who switched banks halfway through must not lose the months
// before. Moves between the owner's own accounts never count, whichever
// accounts they touch.

import type { Db } from '../../db/pool.js'
import { makeDate } from '../../lib/dates.js'
import { countedSql } from '../counted.js'
import { loadEveryAccountPairs } from '../everyAccountPairs.js'
import { transactionsByIds, type Transaction } from '../transactions.js'
import { paysDownDebt } from './classify.js'
import { taxCsv } from './csv.js'
import { summarize, type TaxRow, type TaxRowCategory, type TaxSummary } from './summary.js'

export interface TaxExport {
  filename: string
  csv: string
  summary: TaxSummary
}

/** A counted transaction's id and category, as the year's query reads it. */
export interface CountedRow {
  id: string
  category: TaxRowCategory | null
  /** On a credit card or loan account. */
  onDebtAccount: boolean
}

/**
 * The year's rows with their transactions, in the query's order. Skipped:
 * a row whose transaction is gone by the time it is read (a sync deleted it
 * in between), as if the query had run a moment later; and an unfiled
 * payment into a card or loan (see paysDownDebt), which only pays down
 * money already counted where it was spent, never money in.
 */
export function withTransactions(rows: CountedRow[], transactions: Transaction[]): TaxRow[] {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]))
  return rows.flatMap(({ id, category, onDebtAccount }) => {
    const tx = byId.get(id)
    if (!tx) return []
    if (category === null && onDebtAccount && paysDownDebt(tx)) return []
    return [{ tx, category }]
  })
}

/**
 * The year's counted transactions: posted, not excluded, and not filed as a
 * transfer. Ordered by category name, then date, so each category's lines
 * read in order.
 */
async function countedRows(db: Db, start: string, end: string): Promise<CountedRow[]> {
  const { rows } = await db.query<CountedRow>(
    `SELECT t.id,
       CASE WHEN c.id IS NULL THEN NULL
         ELSE json_build_object('id', c.id, 'name', c.name, 'group', c.group_name, 'kind', c.kind)
       END AS category,
       a.type IN ('credit', 'loan') AS "onDebtAccount"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date BETWEEN $1 AND $2 AND NOT t.excluded AND NOT t.pending AND ${countedSql('c')}
     ORDER BY c.name NULLS LAST, t.date, t.id`,
    [start, end],
  )
  return rows
}

/** The year's export. */
export async function taxExport(db: Db, year: number): Promise<TaxExport> {
  const start = makeDate(year, 1, 1)
  const end = makeDate(year, 12, 31)
  const counted = await countedRows(db, start, end)
  // Moves between own accounts that budgets do not file as transfers, such as
  // paying a hidden card or two unfiled legs of one move, are left out too.
  const moves = await loadEveryAccountPairs(db, start, end)
  const rows = counted.filter((row) => !moves.has(row.id))
  const transactions = await transactionsByIds(
    db,
    rows.map((row) => row.id),
  )
  const taxRows = withTransactions(rows, transactions)
  const summary = summarize(year, taxRows)
  return { filename: `leeway-${year}-tax-summary.csv`, csv: taxCsv(summary, taxRows), summary }
}
