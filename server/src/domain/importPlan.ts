// Deciding which rows of an import to add: pure logic, free of I/O, so the
// duplicate rules can be read and tested on their own.

import type { IsoDate } from '../lib/dates.js'

/**
 * The limits on an import. The server refuses rows past them; the browser
 * applies the same ones while reading a file, so a long cell is cut there
 * instead of failing the whole import.
 */
export const IMPORT_LIMITS = {
  /** Rows in one import: decades of history for one account, and a few megabytes. */
  maxRows: 20_000,
  nameLength: 200,
  categoryLength: 80,
  /** No personal transaction comes near a billion dollars; a bigger one is a misread column. */
  maxAmountCents: 100_000_000_000,
}

/** One row of an import, after the file's columns were mapped in the browser. */
export interface ImportRow {
  date: IsoDate
  name: string
  /** Positive is money out, negative is money in. */
  amountCents: number
  /** A category name from the file, matched to the owner's categories by name. */
  category: string | null
}

/** The fields that say two transactions are the same one. */
export type TransactionKeyFields = Pick<ImportRow, 'date' | 'name' | 'amountCents'>

export interface ImportOptions {
  /**
   * Keep rows that repeat exactly within the file (two equal coffees on one
   * day). Off by default: a repeat usually means the export overlapped itself.
   */
  keepRepeats: boolean
  /** Rows on or after this day are skipped, such as days the bank feed already covers. */
  skipFrom: IsoDate | null
}

export interface ImportPlan {
  /** The rows to add, in file order. */
  add: ImportRow[]
  /** Rows already in the account. */
  alreadyThere: number
  /** Rows that repeat an earlier row of the same file. */
  repeatsInFile: number
  /** Rows on or after `skipFrom`. */
  skippedByDate: number
}

/**
 * A description reduced to what identifies it: lower case, accents folded,
 * and every run of punctuation or spacing turned into one space. "AMAZON.COM*
 * Mktp" and "amazon com mktp" are the same purchase.
 */
export function normalizeDescription(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The identity of a transaction for duplicate checks: same day, same amount, same description. */
export function transactionKey(tx: TransactionKeyFields): string {
  return `${tx.date}|${tx.amountCents}|${normalizeDescription(tx.name)}`
}

/**
 * Decides which rows to add. Matching against what the account already holds
 * is one to one: two equal rows in the file and one already saved adds one,
 * so importing the same file twice adds nothing the second time, and a file
 * that overlaps an earlier import adds only what is new.
 */
export function planImport(
  rows: ImportRow[],
  existing: TransactionKeyFields[],
  options: ImportOptions,
): ImportPlan {
  // How many saved transactions each key still has left to match.
  const unmatched = new Map<string, number>()
  for (const tx of existing) {
    const key = transactionKey(tx)
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1)
  }

  const plan: ImportPlan = { add: [], alreadyThere: 0, repeatsInFile: 0, skippedByDate: 0 }
  const seenInFile = new Set<string>()
  for (const row of rows) {
    if (options.skipFrom !== null && row.date >= options.skipFrom) {
      plan.skippedByDate += 1
      continue
    }
    const key = transactionKey(row)
    const repeat = seenInFile.has(key)
    seenInFile.add(key)
    const left = unmatched.get(key) ?? 0
    if (left > 0) {
      unmatched.set(key, left - 1)
      plan.alreadyThere += 1
    } else if (repeat && !options.keepRepeats) {
      plan.repeatsInFile += 1
    } else {
      plan.add.push(row)
    }
  }
  return plan
}

/** The earliest and latest day among rows, or null for none. ISO dates sort as text. */
export function dateSpan(
  rows: Pick<ImportRow, 'date'>[],
): { first: IsoDate; last: IsoDate } | null {
  if (rows.length === 0) return null
  let first = rows[0]!.date
  let last = first
  for (const { date } of rows) {
    if (date < first) first = date
    if (date > last) last = date
  }
  return { first, last }
}
