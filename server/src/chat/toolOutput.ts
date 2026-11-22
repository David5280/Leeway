// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.
//
// People are kept out two ways. Structurally first: a payment between people
// shows no person at all. It reads "To someone" or "From someone", its note
// is dropped, and a merchant total or repeating series of such payments
// reads "Payment app", whatever names the bank used. Then the names read from those payments are
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

/**
 * A payment between people, as presented (domain/transactions.ts): named
 * after the person. A transfer paired between two of the owner's own
 * accounts is theirs, whatever its line says, so it keeps its name.
 */
function isPersonPaymentRow(row: Row, people: PaymentPeople): boolean {
  return (
    typeof row.displayName === 'string' &&
    typeof row.amountCents === 'number' &&
    typeof row.id === 'string' &&
    !row.transfer &&
    people.transactionIds.has(row.id)
  )
}

// The fields that name a merchant total or a repeating series (top_merchants,
// find_recurring), which read as a payment app when they are a person.
const SERIES_NAME_FIELDS = ['merchant', 'name', 'key'] as const

/** A merchant total or series flagged as payments to a person, or named after a hidden one. */
function isPersonSeries(row: Row, hidden: Hidden): boolean {
  if (row.betweenPeople === true) return true
  return typeof row.merchant === 'string' && foundIn(row.merchant, hidden.everywhere)
}

/** A series' naming fields, each that is set reading as a payment app. */
function asPaymentApp(row: Row): Row {
  const named = SERIES_NAME_FIELDS.filter((field) => typeof row[field] === 'string')
  return { ...row, ...Object.fromEntries(named.map((field) => [field, PAYMENT_APP])) }
}

/**
 * A key with any person in it replaced, numbered when that would land on a
 * key already taken ("someone", "someone 2"), so no value is lost.
 */
function freeKey(key: string, taken: ReadonlySet<string>, hidden: Hidden): string {
  const replaced = replacedIn(key, hidden.everywhere, SOMEONE)
  if (!taken.has(replaced)) return replaced
  let number = 2
  while (taken.has(`${replaced} ${number}`)) number += 1
  return `${replaced} ${number}`
}

/** One field of an object, with any person in it taken out. */
function cleanField(key: string, value: unknown, hidden: Hidden): unknown {
  if (key === 'counterparty') return null
  if (key === 'note' && typeof value === 'string') return replacedIn(value, hidden.inNotes, SOMEONE)
  return withoutPeople(value, hidden)
}

/** An object with every key and field cleaned, then shown without its person if it pays one. */
function cleanRow(row: Row, hidden: Hidden): Row {
  const cleaned: Row = {}
  const taken = new Set<string>()
  for (const [key, field] of Object.entries(row)) {
    const free = freeKey(key, taken, hidden)
    taken.add(free)
    cleaned[free] = cleanField(key, field, hidden)
  }
  if (isPersonSeries(row, hidden)) return asPaymentApp(cleaned)
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
