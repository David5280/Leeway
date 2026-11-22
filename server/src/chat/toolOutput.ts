// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.
//
// People are kept out two ways. Structurally first: a payment between people
// is shown as "To someone" or "From someone", and a merchant total that is a
// person reads "Payment app", whatever names the bank used. Then every name
// that could be a person's is replaced wherever else it is written, as in a
// summary's sentence or the owner's own note.

import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'
import type { PaymentPeople } from '../domain/chat/people.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** Stands in for a person in a list of merchants. */
export const PAYMENT_APP = 'Payment app'

/** The name as a whole word, in any case: not inside a longer word, accented letters included. */
function wholeName(name: string): RegExp {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'giu')
}

type Row = Record<string, unknown>

/** A payment between people, as presented (domain/transactions.ts): named after the person. */
function isPersonPaymentRow(row: Row, people: PaymentPeople): boolean {
  return (
    typeof row.displayName === 'string' &&
    typeof row.amountCents === 'number' &&
    typeof row.id === 'string' &&
    people.transactionIds.has(row.id)
  )
}

/** One field of an object, with any person in it taken out. */
function cleanField(key: string, value: unknown, people: PaymentPeople, names: RegExp[]): unknown {
  if (key === 'counterparty') return null
  // A merchant total (top_merchants and the like) that is really a person.
  if (key === 'merchant' && typeof value === 'string' && names.some((name) => name.test(value))) {
    return PAYMENT_APP
  }
  return withoutPeople(value, people, names)
}

/** The result with every payment between people shown without the person. */
function withoutPeople(value: unknown, people: PaymentPeople, names: RegExp[]): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutPeople(item, people, names))
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  const row = value as Row
  const cleaned = Object.fromEntries(
    Object.entries(row).map(([key, field]) => [key, cleanField(key, field, people, names)]),
  )
  if (!isPersonPaymentRow(row, people)) return cleaned
  // The direction comes from the amount, as everywhere: positive is money out.
  return {
    ...cleaned,
    displayName: (row.amountCents as number) > 0 ? 'To someone' : 'From someone',
  }
}

/**
 * A tool's result as compact JSON for the chat model (every byte is paid
 * for, on every step). Payments between people lose their person, then every
 * name in `people` is replaced wherever it appears, longest first so
 * "Jane Doe" goes before a "Jane" on its own.
 */
export function chatToolText(result: unknown, people: PaymentPeople): string {
  const longestFirst = [...people.names]
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
  // Non-global copies for testing a whole field: a global RegExp's test() keeps state.
  const names = longestFirst.map((name) => new RegExp(wholeName(name).source, 'iu'))
  let text = agentJson(withoutBankText(withoutPeople(result, people, names)), { compact: true })
  for (const name of longestFirst) text = text.replace(wholeName(name), SOMEONE)
  return text
}
