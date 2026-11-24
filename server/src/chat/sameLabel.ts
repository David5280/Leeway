// list_transactions' "sameMerchantAs" for a row Chat shows by a label. Pure.
//
// Charges are grouped by their merchant key, which for a payment to a person
// is that person: "the same merchant as" one "Zelle payment (sent)" would
// show which of them went to whom. So for a labelled row, Chat answers with
// every row shown by the same label instead, as top_merchants merges them.

import type { PaymentPeople } from '../domain/chat/people.js'

/** The most rows one tool call reads (list_transactions' own limit). */
const MOST_ROWS = 500

type Input = Record<string, unknown>
type Listed = { transactions: { id: string }[]; total: number }

/** How a list grouped by label is asked for, and the page of it the model asked for. */
export interface ByLabel {
  /** The call's input without sameMerchantAs, reading as many rows as one call may. */
  input: Input
  /** The page of rows shown by the label, out of what that input read. */
  page: (result: unknown) => Listed
}

/** A whole number from an input, or a default when it is not one. */
function numberIn(input: Input, field: string, fallback: number): number {
  const value = input[field]
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

/**
 * How to answer a list_transactions call grouped by label, or null when the
 * call is not one for the merchant of a labelled row.
 */
export function byLabel(tool: string, input: unknown, people: PaymentPeople): ByLabel | null {
  if (tool !== 'list_transactions' || input === null || typeof input !== 'object') return null
  const { sameMerchantAs, ...rest } = input as Input
  const label = typeof sameMerchantAs === 'string' ? people.rows.get(sameMerchantAs) : undefined
  if (!label) return null
  const offset = numberIn(rest, 'offset', 0)
  const limit = numberIn(rest, 'limit', 100)
  return {
    input: { ...rest, limit: MOST_ROWS, offset: 0 },
    page: (result) => {
      const listed = result as Listed
      const same = listed.transactions.filter((tx) => people.rows.get(tx.id)?.label === label.label)
      return { ...listed, transactions: same.slice(offset, offset + limit), total: same.length }
    },
  }
}
