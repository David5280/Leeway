// Which column of a CSV file holds what, and a first guess at it from the
// column names (or, without a header, from what the columns hold).

import { guessDecimalMark, parseAmount, type DecimalMark } from './amounts'
import { guessDateFormat, parseDate, type DateFormat } from './dates'
import type { CsvTable } from './parse'

/**
 * Where the money is. A file has one signed amount column, separate columns
 * for money out and money in, or one amount column with a type column saying
 * which way the money went (as Mint's export does).
 */
export type AmountColumns =
  | { kind: 'signed'; column: number }
  | { kind: 'split'; debit: number; credit: number }
  | { kind: 'direction'; column: number; direction: number }

export type AmountKind = AmountColumns['kind']

export interface ColumnMapping {
  date: number | null
  description: number | null
  amount: AmountColumns | null
  category: number | null
  account: number | null
  dateFormat: DateFormat
  decimalMark: DecimalMark
  /**
   * Flip every amount's sign. Leeway counts spending as positive; most bank
   * files show it as negative, so for a signed column this is usually on.
   */
  flip: boolean
}

/** How many rows a guess looks at; enough to see a pattern, cheap on a big file. */
const SAMPLE_ROWS = 200

/** Column names for each part, best match first, compared without case, spaces or punctuation. */
const NAMES = {
  date: [
    'transactiondate',
    'transdate',
    'date',
    'posteddate',
    'postingdate',
    'postdate',
    'bookingdate',
    'valuedate',
  ],
  description: [
    'description',
    'payee',
    'merchant',
    'merchantname',
    'name',
    'details',
    'transactiondescription',
    'originaldescription',
    'narrative',
    'memo',
    'reference',
  ],
  amount: ['amount', 'transactionamount', 'value', 'sum'],
  debit: [
    'debit',
    'debits',
    'withdrawal',
    'withdrawals',
    'moneyout',
    'paidout',
    'outflow',
    'spent',
    'debitamount',
  ],
  credit: [
    'credit',
    'credits',
    'deposit',
    'deposits',
    'moneyin',
    'paidin',
    'inflow',
    'received',
    'creditamount',
  ],
  direction: ['transactiontype', 'type', 'debitcredit', 'drcr', 'creditdebitindicator'],
  category: ['category', 'categoryname', 'categories'],
  account: ['account', 'accountname'],
} as const

type Part = keyof typeof NAMES

const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The words a type column uses for money out and money in. */
const OUT_WORDS = [
  'debit',
  'dr',
  'withdrawal',
  'payment',
  'purchase',
  'out',
  'expense',
  'spent',
  'sent',
  'fee',
]
const IN_WORDS = ['credit', 'cr', 'deposit', 'in', 'income', 'refund', 'received', 'interest']

/** Which way a type column's value says the money went, or null if it does not say. */
export function directionOf(value: string): 'out' | 'in' | null {
  const word = plain(value)
  if (OUT_WORDS.includes(word)) return 'out'
  if (IN_WORDS.includes(word)) return 'in'
  return null
}

/** A column's first values, for guessing what it holds. */
function sample(table: CsvTable, column: number): string[] {
  return table.rows
    .slice(0, SAMPLE_ROWS)
    .map((row) => row[column]!)
    .filter((cell) => cell !== '')
}

/** Most of a column's values pass a test (and it has some). */
function mostly(values: string[], test: (value: string) => boolean): boolean {
  return values.length > 0 && values.filter(test).length >= values.length * 0.8
}

/**
 * Finds the column whose name matches a part best: an exact name first, in
 * the order listed, then a name that contains one ("Amount (USD)").
 */
function byName(columns: string[], part: Part, taken: Set<number>): number | null {
  const names: readonly string[] = NAMES[part]
  const free = columns
    .map((name, index) => ({ name: plain(name), index }))
    .filter((c) => !taken.has(c.index))
  for (const wanted of names) {
    const exact = free.find((c) => c.name === wanted)
    if (exact) return exact.index
  }
  return free.find((c) => names.some((wanted) => c.name.includes(wanted)))?.index ?? null
}

/** The first free column whose values pass a test. */
function byValues(
  table: CsvTable,
  taken: Set<number>,
  test: (value: string) => boolean,
): number | null {
  const index = table.columns.findIndex(
    (_, column) => !taken.has(column) && mostly(sample(table, column), test),
  )
  return index === -1 ? null : index
}

/** The free column with the longest text on average: without names, that is the description. */
function longestText(table: CsvTable, taken: Set<number>): number | null {
  let best: number | null = null
  let bestLength = 0
  table.columns.forEach((_, column) => {
    if (taken.has(column)) return
    const values = sample(table, column)
    const length = values.reduce((sum, value) => sum + value.length, 0) / Math.max(1, values.length)
    if (length > bestLength) {
      best = column
      bestLength = length
    }
  })
  return best
}

/** Finds the money columns, by name and then by values. */
function guessAmount(table: CsvTable, taken: Set<number>): AmountColumns | null {
  const find = (part: Part) => (table.hasHeader ? byName(table.columns, part, taken) : null)
  const debit = find('debit')
  const credit = find('credit')
  if (debit !== null && credit !== null) return { kind: 'split', debit, credit }

  const column =
    find('amount') ??
    byValues(
      table,
      taken,
      (value) => parseAmount(value, '.') !== null && parseDate(value, 'mdy') === null,
    )
  if (column === null) return null
  const direction = find('direction')
  if (
    direction !== null &&
    mostly(sample(table, direction), (value) => directionOf(value) !== null)
  ) {
    return { kind: 'direction', column, direction }
  }
  return { kind: 'signed', column }
}

/** The columns that hold the money, to read their decimal mark and signs. */
export function amountColumnsOf(amount: AmountColumns): number[] {
  if (amount.kind === 'split') return [amount.debit, amount.credit]
  return [amount.column]
}

/**
 * A first guess at the whole mapping. The owner sees a preview and can fix
 * any of it. For one signed column, the signs are flipped when most amounts
 * are negative: there are more purchases than paychecks, so a file whose
 * values are mostly negative shows spending as negative.
 */
export function guessMapping(table: CsvTable, preferredDateFormat: DateFormat): ColumnMapping {
  const taken = new Set<number>()
  const claim = (column: number | null) => {
    if (column !== null) taken.add(column)
    return column
  }
  const find = (part: Part) => (table.hasHeader ? byName(table.columns, part, taken) : null)

  const date = claim(
    find('date') ??
      byValues(table, taken, (value) => parseDate(value, preferredDateFormat) !== null),
  )
  const amount = guessAmount(table, taken)
  if (amount) amountColumnsOf(amount).forEach(claim)
  if (amount?.kind === 'direction') claim(amount.direction)
  const category = claim(find('category'))
  const account = claim(find('account'))
  const description = claim(find('description') ?? longestText(table, taken))

  const moneyValues = amount
    ? amountColumnsOf(amount).flatMap((column) => sample(table, column))
    : []
  const decimalMark = guessDecimalMark(moneyValues)
  const signed =
    amount?.kind === 'signed'
      ? sample(table, amount.column).map((v) => parseAmount(v, decimalMark))
      : []
  const negatives = signed.filter((cents) => cents !== null && cents < 0).length
  const positives = signed.filter((cents) => cents !== null && cents > 0).length

  return {
    date,
    description,
    amount,
    category,
    account,
    dateFormat: guessDateFormat(date === null ? [] : sample(table, date), preferredDateFormat)
      .format,
    decimalMark,
    flip: negatives > positives,
  }
}
