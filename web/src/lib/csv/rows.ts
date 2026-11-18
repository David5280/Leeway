// Turning a CSV table into the rows Leeway saves, by the owner's mapping, and
// saying plainly which rows could not be read and why.

import { IMPORT_LIMITS, transactionKey } from '../../../../server/src/domain/importPlan'
import { parseAmount } from './amounts'
import { parseDate } from './dates'
import { directionOf, type ColumnMapping } from './mapping'
import type { CsvTable } from './parse'

/** One row as it will be saved; the server's import_transactions takes these. */
export interface PreparedRow {
  date: string
  name: string
  /** Positive is money out, negative is money in, as everywhere in Leeway. */
  amountCents: number
  category: string | null
}

export interface RowProblem {
  /**
   * The row's number as a spreadsheet shows the file, so a header row is row 1
   * and the first data row is row 2 (blank lines are not counted).
   */
  row: number
  /** What is wrong, said to follow "Row 4": "has no date". */
  reason: string
}

export interface PreparedRows {
  rows: PreparedRow[]
  problems: RowProblem[]
}

// The server's limits, applied here too so a long cell is cut, not refused.
const { nameLength, categoryLength, maxAmountCents } = IMPORT_LIMITS

/** What the owner must still choose before anything can be read, or null when nothing is missing. */
export function missingColumn(mapping: ColumnMapping): string | null {
  if (mapping.date === null) return 'Choose the column with the date.'
  if (mapping.description === null) return 'Choose the column with the description.'
  if (mapping.amount === null) return 'Choose the column with the amount.'
  return null
}

/**
 * The amount of one row in Leeway's sign (spending positive), before any
 * flip, or a reason it cannot be read. Money-out and money-in columns are
 * read without their signs, since banks write them either way.
 */
function amountOf(cells: string[], mapping: ColumnMapping): number | string {
  const amount = mapping.amount!
  const read = (column: number) => parseAmount(cells[column]!, mapping.decimalMark)
  if (amount.kind === 'split') {
    const [out, into] = [cells[amount.debit]!, cells[amount.credit]!]
    if (!out && !into) return 'has no amount'
    const outCents = out ? read(amount.debit) : 0
    const inCents = into ? read(amount.credit) : 0
    if (outCents === null) return `has "${out}", which is not an amount`
    if (inCents === null) return `has "${into}", which is not an amount`
    return Math.abs(outCents) - Math.abs(inCents)
  }
  const cell = cells[amount.column]!
  const cents = read(amount.column)
  if (cents === null) return cell ? `has "${cell}", which is not an amount` : 'has no amount'
  if (amount.kind === 'signed') return cents
  const way = directionOf(cells[amount.direction]!)
  if (way === null)
    return `has "${cells[amount.direction]}", which does not say if money went out or came in`
  return way === 'out' ? Math.abs(cents) : -Math.abs(cents)
}

/** One data row, read by the mapping: the row to save, or why it cannot be. */
function prepareRow(cells: string[], mapping: ColumnMapping): PreparedRow | string {
  const dateCell = cells[mapping.date!]!
  const date = parseDate(dateCell, mapping.dateFormat)
  if (!date) return dateCell ? `has "${dateCell}", which is not a date` : 'has no date'
  const name = cells[mapping.description!]!.replace(/\s+/g, ' ').slice(0, nameLength).trim()
  if (!name) return 'has no description'
  const amount = amountOf(cells, mapping)
  if (typeof amount === 'string') return amount
  if (Math.abs(amount) > maxAmountCents) return 'has an amount too large to be real'
  const category =
    mapping.category === null ? '' : cells[mapping.category]!.slice(0, categoryLength).trim()
  return {
    date,
    name,
    // A flip of zero stays zero, never -0.
    amountCents: mapping.flip && amount !== 0 ? -amount : amount,
    category: category || null,
  }
}

/**
 * Reads every data row. With an account column mapped, `onlyAccount` keeps
 * the rows of one account in the file (an export from another app often
 * holds several); null keeps them all.
 */
export function prepareRows(
  table: CsvTable,
  mapping: ColumnMapping,
  onlyAccount: string | null = null,
): PreparedRows {
  const result: PreparedRows = { rows: [], problems: [] }
  if (missingColumn(mapping)) return result
  // Data rows start on row 2 when a header row sits above them.
  const firstRow = table.hasHeader ? 2 : 1
  table.rows.forEach((cells, index) => {
    if (onlyAccount !== null && mapping.account !== null && cells[mapping.account] !== onlyAccount)
      return
    const prepared = prepareRow(cells, mapping)
    if (typeof prepared === 'string')
      result.problems.push({ row: firstRow + index, reason: prepared })
    else result.rows.push(prepared)
  })
  return result
}

/** The accounts named in the file's account column, with how many rows each has, most first. */
export function accountsInFile(
  table: CsvTable,
  column: number | null,
): { name: string; rows: number }[] {
  if (column === null) return []
  const counts = new Map<string, number>()
  for (const cells of table.rows) counts.set(cells[column]!, (counts.get(cells[column]!) ?? 0) + 1)
  return [...counts]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name))
}

/** Rows that repeat an earlier row exactly, which the import skips unless told to keep them. */
export function countRepeats(rows: PreparedRow[]): number {
  const seen = new Set<string>()
  let repeats = 0
  for (const row of rows) {
    // The server's own duplicate key, so the app knows when the choice matters.
    const key = transactionKey(row)
    if (seen.has(key)) repeats += 1
    seen.add(key)
  }
  return repeats
}
