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
  'social_security',
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

/** A payer's running total, named as its first line of the year shows it. */
interface Payer {
  name: string
  cents: number
}

/**
 * Words banks add to a payroll deposit that say nothing of who paid: ACH
 * entry codes and the labels before ids, as in "ACME PAYROLL PPD ID 123".
 */
const PAYROLL_NOISE = /\b(ppd|ccd|ctx|ach|web|id|co|entry|descr|des|indn|orig|trace)\b/g

/**
 * What groups one payer's deposits: its merchant key (digits and symbols
 * already gone) less ACH noise, so "ACME PAYROLL PPD ID 123" and "ACME
 * PAYROLL" are one source.
 */
export function payerKey(tx: Pick<Transaction, 'merchantName' | 'name'>): string {
  return merchantKey(tx).replace(PAYROLL_NOISE, ' ').replace(/\s+/g, ' ').trim()
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
    const key = payerKey(tx)
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
