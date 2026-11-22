// The year's export as CSV text: each category's transactions and a total
// line, then the summary as its own block at the end, so someone who is only
// sent the file still sees pay, interest, dividends and the rest. Pure.

import { INCOME_LINES, incomeLine, MAY_BE_DEDUCTIBLE } from './classify.js'
import { SUMMED_LINES, type SummedLine } from './income.js'
import {
  lineKey,
  MONEY_IN_NOT_CATEGORIZED,
  rowKey,
  type TaxRow,
  type TaxSummary,
} from './summary.js'

export const CSV_HEADER = 'Category,Group,Date,Name,Account,Amount,Note'

export const NOT_TAX_ADVICE = 'A summary of what happened, not tax advice'
export const CATEGORIZE_HINT =
  'Could be pay, interest or a refund; categorize these rows so each counts on its line'

/** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

/** A line with only a label, an amount and a note, as total and summary lines are. */
function labeledLine(label: string, cents: number, note = ''): string {
  return [csvCell(label), '', '', '', '', dollars(cents), csvCell(note)].join(',')
}

/** A row's note: why income is not pay, then anything the owner wrote. */
function rowNote({ tx, category }: TaxRow): string {
  const notPay = category?.kind === 'income' ? INCOME_LINES[incomeLine(tx)].note : ''
  return [notPay, tx.note].filter(Boolean).join('; ')
}

/** One transaction's line, its amount read in its category's direction. */
function transactionLine(row: TaxRow, name: string, moneyIn: boolean): string {
  const { tx } = row
  return [
    csvCell(name),
    csvCell(row.category?.group ?? ''),
    tx.date,
    csvCell(tx.displayName),
    csvCell(tx.accountName),
    dollars(moneyIn ? -tx.amountCents : tx.amountCents),
    csvCell(rowNote(row)),
  ].join(',')
}

/** Each summed income line's figure in the summary. */
export function lineCents(summary: TaxSummary): Record<SummedLine, number> {
  return {
    pay: summary.payCents,
    interest: summary.interestCents,
    dividends: summary.dividendsCents,
    unemployment: summary.unemploymentCents,
    retirement: summary.retirementCents,
    tax_refund: summary.taxRefundCents,
    rewards: summary.rewardsCents,
  }
}

/**
 * The summary block: set apart by a blank line, then Pay and who paid it,
 * every other income line (zero ones too, so the file always reads the same),
 * and money in not categorized.
 */
function summaryBlock(summary: TaxSummary): string[] {
  const heading = [`Summary for ${summary.year}`, '', '', '', '', 'Amount', NOT_TAX_ADVICE]
  const unfiledHint = summary.unfiledInCents > 0 ? CATEGORIZE_HINT : ''
  const cents = lineCents(summary)
  const figure = (line: SummedLine) => labeledLine(INCOME_LINES[line].label, cents[line])
  return [
    '',
    heading.map(csvCell).join(','),
    figure('pay'),
    ...summary.income.map((source) => labeledLine(`Pay from ${source.source}`, source.cents)),
    ...SUMMED_LINES.filter((line) => line !== 'pay').map(figure),
    labeledLine(MONEY_IN_NOT_CATEGORIZED, summary.unfiledInCents, unfiledHint),
  ]
}

/** The whole CSV, with Windows line endings as spreadsheets expect. */
export function taxCsv(summary: TaxSummary, rows: TaxRow[]): string {
  const rowsByLine = new Map<string, TaxRow[]>()
  for (const row of rows) {
    const key = rowKey(row)
    const group = rowsByLine.get(key)
    if (group) group.push(row)
    else rowsByLine.set(key, [row])
  }
  const lines = [CSV_HEADER]
  for (const category of summary.categories) {
    // Every category line was summed from these same rows, so it always has some.
    for (const row of rowsByLine.get(lineKey(category))!) {
      lines.push(transactionLine(row, category.name, category.moneyIn))
    }
    const flag = category.mayBeDeductible ? MAY_BE_DEDUCTIBLE : ''
    lines.push(labeledLine(`Total: ${category.name}`, category.totalCents, flag))
  }
  lines.push(...summaryBlock(summary))
  return `${lines.join('\r\n')}\r\n`
}
