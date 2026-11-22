// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.
//
// People are kept out two ways. Structurally first: a payment between people
// shows no person at all. It reads "To someone" or "From someone", its note
// is dropped, and a merchant total of such payments reads "Payment app",
// whatever names the bank used. Then the names read from those payments are
// replaced wherever else they are written, as each string is walked, so no
// escaping in the JSON can hide one: full names in every field, and single
// words of names only alone in the owner's notes (domain/chat/personNames.ts).

import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import { foundIn, fullNamePattern, loneNamePattern, replacedIn } from './namePatterns.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** Stands in for a person in a list of merchants. */
export const PAYMENT_APP = 'Payment app'

/** What Chat hides in a tool's result. */
interface Hidden {
  people: PaymentPeople
  /** Full names, longest first, so "Jane Doe" goes before a "Jane" alone. */
  everywhere: RegExp[]
  /** Full names, then single words of names, for the owner's notes. */
  inNotes: RegExp[]
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

/** A merchant total (top_merchants and the like) that is payments to a person. */
function isPersonTotal(row: Row, hidden: Hidden): boolean {
  if (typeof row.merchant !== 'string') return false
  return row.betweenPeople === true || foundIn(row.merchant, hidden.everywhere)
}

/** One field of an object, with any person in it taken out. */
function cleanField(key: string, value: unknown, hidden: Hidden): unknown {
  if (key === 'counterparty') return null
  if (key === 'note' && typeof value === 'string') return replacedIn(value, hidden.inNotes, SOMEONE)
  return withoutPeople(value, hidden)
}

/** An object with every key and field cleaned, then shown without its person if it pays one. */
function cleanRow(row: Row, hidden: Hidden): Row {
  const cleaned = Object.fromEntries(
    Object.entries(row).map(([key, field]) => [
      replacedIn(key, hidden.everywhere, SOMEONE),
      cleanField(key, field, hidden),
    ]),
  )
  if (isPersonTotal(row, hidden)) return { ...cleaned, merchant: PAYMENT_APP }
  if (!isPersonPaymentRow(row, hidden.people)) return cleaned
  // The direction comes from the amount, as everywhere: positive is money out.
  const displayName = (row.amountCents as number) > 0 ? 'To someone' : 'From someone'
  return 'note' in row ? { ...cleaned, displayName, note: null } : { ...cleaned, displayName }
}

/** The result with no person from a payment between people left in it. */
function withoutPeople(value: unknown, hidden: Hidden): unknown {
  if (typeof value === 'string') return replacedIn(value, hidden.everywhere, SOMEONE)
  if (Array.isArray(value)) return value.map((item) => withoutPeople(item, hidden))
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  return cleanRow(value as Row, hidden)
}

/**
 * A tool's result as compact JSON for the chat model (every byte is paid
 * for, on every step), with every payment between people shown without its
 * person and every name in `people` replaced as each string is walked.
 */
export function chatToolText(result: unknown, people: PaymentPeople): string {
  const everywhere = people.names
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
    .map(fullNamePattern)
  const hidden: Hidden = {
    people,
    everywhere,
    inNotes: [...everywhere, ...people.loneNames.map(loneNamePattern)],
  }
  return agentJson(withoutBankText(withoutPeople(result, hidden)), { compact: true })
}
