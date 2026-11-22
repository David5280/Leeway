// The year's money in under income categories, by line: pay by who paid it,
// then interest, dividends, benefits, refunds and rewards, each on its own
// line since none of them is wages. Pure.

import { merchantKey } from '../merchantKey.js'
import type { Transaction } from '../transactions.js'
import { incomeLine, type IncomeLine } from './classify.js'

/**
 * The lines the summary adds up. Payments from people and money moved in
 * from another account are neither earned nor paid out to the owner, so they
 * stay in their category's total with a note (see INCOME_LINES), on no line here.
 */
export type SummedLine = Exclude<IncomeLine, 'person' | 'moved_in'>

/** The summed lines, in the order the summary shows them. */
export const SUMMED_LINES: readonly SummedLine[] = [
  'pay',
  'interest',
  'dividends',
  'unemployment',
  'retirement',
  'tax_refund',
  'rewards',
]

/** One payer's net pay for the year. */
export interface PaySource {
  /** What groups the payer's lines: its merchant key (see merchantKey). */
  key: string
  source: string
  cents: number
}

export interface IncomeTotals {
  /** Pay by who paid it, net of any paid back, largest first. Adds up to the pay line. */
  sources: PaySource[]
  /** Each summed line's total, money in positive. */
  totals: Record<SummedLine, number>
}

/** A payer as rows group: by merchant key, so "ACME PAYROLL 0115" and "ACME PAYROLL 0215" are one. */
interface Payer {
  name: string
  cents: number
}

/** Adds up money in filed under income categories (pass only those transactions). */
export function incomeTotals(transactions: Transaction[]): IncomeTotals {
  const totals = Object.fromEntries(SUMMED_LINES.map((line) => [line, 0])) as Record<
    SummedLine,
    number
  >
  const payers = new Map<string, Payer>()
  for (const tx of transactions) {
    const line = incomeLine(tx)
    if (line === 'person' || line === 'moved_in') continue
    const cents = -tx.amountCents
    totals[line] += cents
    if (line !== 'pay') continue
    // A payer is named as its first line of the year shows it.
    const key = merchantKey(tx)
    const payer = payers.get(key) ?? { name: tx.displayName, cents: 0 }
    payer.cents += cents
    payers.set(key, payer)
  }
  // Each payer's net, money paid back included, so the sources add up to Pay.
  const sources = [...payers]
    .map(([key, { name, cents }]) => ({ key, source: name, cents }))
    .filter((source) => source.cents !== 0)
    .sort((a, b) => b.cents - a.cents)
  return { sources, totals }
}
