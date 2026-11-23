// The year's money in under income categories, by line: pay by who paid it,
// then interest, dividends, benefits, refunds and rewards, each on its own
// line since none of them is wages. Pure.

import { merchantKey, textKey } from '../merchantKey.js'
import type { Transaction } from '../transactions.js'
import { incomeLine, type IncomeLine, type UnsummedLine } from './incomeLine.js'

/**
 * The lines the summary leaves out. Payments from people, child support,
 * charges given back and money moved in from another account are neither
 * earned nor taxed as pay, and veterans benefits are not taxed, so each stays
 * in its category's total with a note (see INCOME_LINES), on no line here.
 */
const UNSUMMED_LINES: ReadonlySet<IncomeLine> = new Set<UnsummedLine>([
  'veterans',
  'support',
  'charge_back',
  'person',
  'moved_in',
])

/** The lines the summary adds up. */
export type SummedLine = Exclude<IncomeLine, UnsummedLine>

/** Whether the summary adds up a line (see UNSUMMED_LINES). */
const isSummed = (line: IncomeLine): line is SummedLine => !UNSUMMED_LINES.has(line)

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
  /** What groups the payer's lines (see payerKey). */
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

// What banks add to a payroll deposit that says nothing of who paid. Each is
// only removed in a form that cannot be part of a name, so "STATE OF CO
// PAYROLL" and "STATE OF ID PAYROLL" stay apart and "CO-OP FOODS" stays whole.
const PAYROLL_NOISE = [
  // Any id after a written label: "ID:AB12CD", "ID#123", "CO ID:XXXXX5678".
  /\b(co\s+)?id\s*[:#]\s*[a-z0-9]+\b/gi,
  // An id after "ID" beside an ACH code or "CO", holding a digit or a masked
  // run: "PPD ID 123", "CO ID XXXXX5678". A lone "ID 0115" may be Idaho's.
  /\b(co|ppd|ccd|ctx|web|ach)\s+id\s+[a-z0-9]*(\d|xxx)[a-z0-9]*\b/gi,
  // Who received it, as Bank of America writes it: "INDN:JANE DOE", up to the next label.
  /\bindn\s*:.*?(?=\s+(co\s+id|[a-z]+\s*:)|$)/gi,
  // Labels before a value: "DES:PAYROLL" keeps "PAYROLL".
  /\b(des|descr|entry|orig|trace)\s*:/gi,
  // ACH entry codes, with a bare "ID" label after one: "PPD ID".
  /\b(ppd|ccd|ctx|ach|web)(\s+id)?\b/gi,
]

/**
 * What groups one payer's deposits: the payer's text less bank noise,
 * reduced as merchant keys are (see textKey), so "ACME PAYROLL PPD ID 123"
 * and "ACME PAYROLL" are one source. Falls back to the plain merchant key
 * when nothing is left.
 */
export function payerKey(tx: Pick<Transaction, 'merchantName' | 'name'>): string {
  const text = PAYROLL_NOISE.reduce(
    (rest, noise) => rest.replace(noise, ' '),
    tx.merchantName ?? tx.name,
  )
  return textKey(text) || merchantKey(tx)
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
    if (!isSummed(line)) continue
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
