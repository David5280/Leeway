// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.
//
// People are kept out two ways. Structurally first: a payment between
// people shows no person at all. It reads "To someone" or "From someone",
// its note is dropped, and a merchant total, repeating series or bill of
// such payments reads "Payment app", whatever names the bank used. A bank
// transfer, whose line may name anyone, reads as its kind ("Transfer to
// savings"). Then the names read from the payments are replaced wherever
// else they are written, as each string is walked, so no escaping in the
// JSON can hide one: full names in every field, and single words of names
// only alone in the owner's notes (domain/chat/personNames.ts).

import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'
import { billLabel, PAYMENT_APP, type PaymentPeople } from '../domain/chat/people.js'
import { foundIn, fullNamePattern, loneNamePattern, replacedIn } from './namePatterns.js'

export { PAYMENT_APP }

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** What Chat hides in a tool's result. */
interface Hidden {
  people: PaymentPeople
  /** Full names, longest first, so "Jane Doe" goes before a "Jane" alone. */
  everywhere: RegExp[]
  /** Full names, then single words of names, for the owner's notes. */
  inNotes: RegExp[]
}

type Row = Record<string, unknown>

/** A transaction as presented (domain/transactions.ts): named, with an amount and an id. */
function isTransactionRow(row: Row): row is Row & { id: string; amountCents: number } {
  return (
    typeof row.displayName === 'string' &&
    typeof row.amountCents === 'number' &&
    typeof row.id === 'string'
  )
}

/** How a transaction row is shown instead of by its own name, and whether its note stays. */
interface ShownAs {
  displayName: string
  keepsNote: boolean
}

/**
 * A payment between people reads "To someone" or "From someone", its note
 * dropped; a bank transfer reads as its kind, its note kept. A transfer
 * paired between two of the owner's own accounts is theirs, whatever its
 * line says, so it keeps its name.
 */
function shownAs(row: Row, people: PaymentPeople): ShownAs | null {
  if (!isTransactionRow(row) || row.transfer) return null
  if (people.transactionIds.has(row.id)) {
    // The direction comes from the amount, as everywhere: positive is money out.
    const displayName = row.amountCents > 0 ? 'To someone' : 'From someone'
    return { displayName, keepsNote: false }
  }
  const label = people.bankTransfers.get(row.id)
  return label ? { displayName: label, keepsNote: true } : null
}

// The fields that name a merchant total, a repeating series or a bill
// (top_merchants, find_recurring, list_bills), which read as their label.
const NAME_FIELDS = ['merchant', 'name', 'key', 'matchPattern'] as const

/**
 * What a merchant total, series or bill reads as instead of its name: a
 * payment app when it pays a person (flagged, tracking such payments, or
 * named after a hidden person), a bank transfer's label when it is one.
 */
function labelOf(row: Row, hidden: Hidden): string | null {
  if (row.betweenPeople === true) return PAYMENT_APP
  if (typeof row.transferLabel === 'string') return row.transferLabel
  const tracked = typeof row.matchPattern === 'string' && billLabel(row.matchPattern, hidden.people)
  if (tracked) return tracked
  return typeof row.merchant === 'string' && foundIn(row.merchant, hidden.everywhere)
    ? PAYMENT_APP
    : null
}

/** A row's naming fields, each that is set reading as the label, which is then not repeated. */
function relabelled(row: Row, label: string): Row {
  const { transferLabel: _label, ...rest } = row
  const named = NAME_FIELDS.filter((field) => typeof rest[field] === 'string')
  return { ...rest, ...Object.fromEntries(named.map((field) => [field, label])) }
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

/** An object with every key and field cleaned, then shown by its label or without its person. */
function cleanRow(row: Row, hidden: Hidden): Row {
  const cleaned: Row = {}
  const taken = new Set<string>()
  for (const [key, field] of Object.entries(row)) {
    const free = freeKey(key, taken, hidden)
    taken.add(free)
    cleaned[free] = cleanField(key, field, hidden)
  }
  const label = labelOf(row, hidden)
  if (label) return relabelled(cleaned, label)
  const shown = shownAs(row, hidden.people)
  if (!shown) return cleaned
  const dropsNote = !shown.keepsNote && 'note' in row
  return { ...cleaned, displayName: shown.displayName, ...(dropsNote ? { note: null } : {}) }
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
