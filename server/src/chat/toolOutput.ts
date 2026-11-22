// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.
//
// People are kept out two ways. Structurally first: a payment between people
// is shown as "To someone" or "From someone", and a merchant total that is a
// person reads "Payment app", whatever names the bank used. Then every name
// that could be a person's is replaced wherever else it is written, as in a
// summary's sentence or the owner's own note. A person's given name or
// surname alone ("Dinner with Jane") is replaced only in a note, where the
// owner writes about people, and only as written with a capital.

import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'
import type { PaymentPeople } from '../domain/chat/people.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** Stands in for a person in a list of merchants. */
export const PAYMENT_APP = 'Payment app'

/** Text that matches itself literally in a RegExp. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Not inside a longer word, accented letters and digits included.
const WORD_START = '(?<![\\p{L}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{N}])'

/**
 * The name as a whole word, in any case, with its words apart however they
 * are joined: "Jane Doe" also matches "JANE_DOE", "jane-doe" and "Jane.Doe".
 */
function wholeName(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(escaped).join('[\\s._-]+')
  return new RegExp(`${WORD_START}${words}${WORD_END}`, 'giu')
}

/** One word exactly as written, capital included, as a whole word. */
function loneWord(word: string): RegExp {
  return new RegExp(`${WORD_START}${escaped(word)}${WORD_END}`, 'gu')
}

/** What Chat replaces in a tool's result: full names anywhere, lone names in notes. */
interface Hidden {
  people: PaymentPeople
  /** Each full name, longest first, for testing a whole field (no global state). */
  names: RegExp[]
  /** Each full name, longest first, for replacing every match. */
  everywhere: RegExp[]
  /** Each given name or surname, for replacing where written alone in a note. */
  alone: RegExp[]
}

/** A note with every person in it replaced: full names first, so "Jane Doe" goes before "Jane". */
function hiddenInNote(note: string, hidden: Hidden): string {
  return [...hidden.everywhere, ...hidden.alone].reduce(
    (text, name) => text.replace(name, SOMEONE),
    note,
  )
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
function cleanField(key: string, value: unknown, hidden: Hidden): unknown {
  if (key === 'counterparty') return null
  if (typeof value === 'string') {
    // A merchant total (top_merchants and the like) that is really a person.
    if (key === 'merchant' && hidden.names.some((name) => name.test(value))) return PAYMENT_APP
    if (key === 'note') return hiddenInNote(value, hidden)
  }
  return withoutPeople(value, hidden)
}

/** The result with every payment between people shown without the person. */
function withoutPeople(value: unknown, hidden: Hidden): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutPeople(item, hidden))
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  const row = value as Row
  const cleaned = Object.fromEntries(
    Object.entries(row).map(([key, field]) => [key, cleanField(key, field, hidden)]),
  )
  if (!isPersonPaymentRow(row, hidden.people)) return cleaned
  // The direction comes from the amount, as everywhere: positive is money out.
  return {
    ...cleaned,
    displayName: (row.amountCents as number) > 0 ? 'To someone' : 'From someone',
  }
}

/**
 * A tool's result as compact JSON for the chat model (every byte is paid
 * for, on every step). Payments between people lose their person, notes lose
 * a person's given name or surname alone, then every name in `people` is
 * replaced wherever it appears, longest first so "Jane Doe" goes before a
 * "Jane" on its own.
 */
export function chatToolText(result: unknown, people: PaymentPeople): string {
  const longestFirst = people.names
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
  const everywhere = longestFirst.map(wholeName)
  const hidden: Hidden = {
    people,
    names: everywhere.map((name) => new RegExp(name.source, 'iu')),
    everywhere,
    alone: people.loneNames.map(loneWord),
  }
  let text = agentJson(withoutBankText(withoutPeople(result, hidden)), { compact: true })
  for (const name of everywhere) text = text.replace(name, SOMEONE)
  return text
}
