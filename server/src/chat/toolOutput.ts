// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no name that could be a person's. The owner's chat goes to Anthropic, and
// the people they pay never chose that. Pure.
//
// Chat hides by default (domain/modelLabels.ts). A transaction whose name is
// not surely a merchant's reads as its label ("Zelle payment (sent)"), with
// no person. A merchant total or series of them reads as the label too, one
// row per label (labelledRows.ts), and a bill tracking them loses its
// pattern, and its name when that could be a person's
// (domain/chat/billLabels.ts). Then, as each string is walked, so no
// escaping in the JSON can hide one:
//
// - an owner's label holding a word that could be a name reads with that
//   word as "someone" ("someone's college fund"), wherever the label is
//   written, but nowhere else ("Will I make it to payday?" stays);
// - what labelled rows would have been shown as is replaced by their label
//   (one word alone by "someone": "Brightwater rent" is about a person);
// - the names read from them go as "someone", full names and single words
//   alike, but a common word or one of the owner's account names' words;
// - no string shows an account mask.
//
// A transaction's note, the owner's own words about it, is never sent.

import { wordsOf } from '../domain/chat/billLabels.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import type { RowLabel } from '../domain/modelLabels.js'
import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'
import { APOSTROPHES } from '../domain/personShape.js'
import { mergedByLabel } from './labelledRows.js'
import {
  fullNamePattern,
  loneNamePattern,
  maskPattern,
  replacedIn,
  type Replacement,
} from './namePatterns.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** Stands in for an account mask wherever one is written. */
export const MASKED = '••••'

// Every apostrophe that is not a straight one, as shops' names are compared without.
const CURLY = new RegExp(`[${APOSTROPHES.replace("'", '')}]`, 'g')

/** What Chat hides in a tool's result. */
interface Hidden {
  people: PaymentPeople
  /**
   * Owner's labels holding a name as they read without it, then shown names
   * by their label, full names, and single words of names by "someone", but
   * a word of the owner's account names, which stay.
   */
  names: Replacement[]
  /** Account masks, looked for once names are gone, so one inside a kept shop's name goes too. */
  masks: Replacement[]
}

type Row = Record<string, unknown>

// The fields that name a transaction, a merchant total, a series or a bill.
const NAME_FIELDS = ['displayName', 'merchant', 'name', 'key'] as const

// An id (a row's, or an object keyed by one), which holds no name or mask, but
// whose digits or letters may look like one ("9f1c4417-ab3e-..." beside a mask 4417).
const AN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A text with anything hidden in it replaced, but an id kept whole so a tool can take it back. */
function scrubbed(text: string, hidden: Hidden): string {
  return AN_ID.test(text) ? text : replacedIn(replacedIn(text, hidden.names), hidden.masks)
}

/**
 * A row without its note when it is money that moved (a transaction, a held
 * charge: a date and an amount). That note is the owner's own words about
 * it, which may name anyone; Leeway's own notes, like a plan's, are on rows
 * with no date and amount, and stay.
 */
function withoutOwnersNote(row: Row): Row {
  if (!('date' in row && 'amountCents' in row)) return row
  const { note: _note, ...rest } = row
  return rest
}

/** A row's naming fields, each that is set reading as the label. */
function named(row: Row, label: string, fields: readonly string[] = NAME_FIELDS): Row {
  const set = fields.filter((field) => typeof row[field] === 'string')
  return { ...row, ...Object.fromEntries(set.map((field) => [field, label])) }
}

/** The label of the transaction a row is or points at (a list row, a leak's charge), if any. */
function transactionLabel(row: Row, people: PaymentPeople): RowLabel | undefined {
  const id = row.transactionId ?? row.id
  return typeof id === 'string' ? people.rows.get(id) : undefined
}

/**
 * A labelled transaction reads as its label, with no person. A transfer
 * paired between two of the owner's own accounts keeps the name it is shown
 * by, which is made of their accounts' names.
 */
function asTransaction(row: Row, shown: RowLabel): Row {
  const fields = row.transfer ? NAME_FIELDS.filter((field) => field !== 'displayName') : NAME_FIELDS
  const relabelled = named(row, shown.label, fields)
  if ('person' in row) relabelled.person = null
  return relabelled
}

/** A bill tracking labelled rows: no pattern, and its label for a name when it was renamed. */
function asBill(row: Row, people: PaymentPeople): Row | null {
  const id = row.billId ?? row.id
  const shown = typeof id === 'string' ? people.bills.get(id) : undefined
  if (!shown) return null
  const { matchPattern: _pattern, ...rest } = row
  return shown.renamed ? named(rest, shown.label, ['name']) : rest
}

/** A row shown by its label, when it is or points at a labelled transaction, bill or total. */
function relabelled(row: Row, people: PaymentPeople): Row {
  const shown = transactionLabel(row, people)
  if (shown) return asTransaction(row, shown)
  const bill = asBill(row, people)
  if (bill) return bill
  if (typeof row.modelLabel !== 'string') return row
  const { matchPattern: _pattern, ...rest } = row
  return named(rest, row.modelLabel)
}

/**
 * A key with anything hidden in it replaced, numbered when that would land
 * on a key already taken ("someone", "someone 2"), so no value is lost.
 */
function freeKey(key: string, taken: ReadonlySet<string>, hidden: Hidden): string {
  const replaced = scrubbed(key, hidden)
  if (!taken.has(replaced)) return replaced
  let number = 2
  while (taken.has(`${replaced} ${number}`)) number += 1
  return `${replaced} ${number}`
}

/** One field of an object, with anything hidden in it replaced. */
function cleanField(key: string, value: unknown, hidden: Hidden): unknown {
  if (key === 'counterparty') return null
  if (typeof value !== 'string') return walked(value, hidden)
  return scrubbed(value, hidden)
}

/** An object with no owner's note, shown by its label where it has one, every key and field cleaned. */
function cleanRow(row: Row, hidden: Hidden): Row {
  const cleaned: Row = {}
  const taken = new Set<string>()
  for (const [key, field] of Object.entries(relabelled(withoutOwnersNote(row), hidden.people))) {
    const free = freeKey(key, taken, hidden)
    taken.add(free)
    cleaned[free] = cleanField(key, field, hidden)
  }
  return cleaned
}

/** The result with every labelled row shown by its label and every hidden name replaced. */
function walked(value: unknown, hidden: Hidden): unknown {
  if (typeof value === 'string') return scrubbed(value, hidden)
  if (Array.isArray(value)) return mergedByLabel(value.map((item) => walked(item, hidden)))
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  return cleanRow(value as Row, hidden)
}

/**
 * The names of shops the owner buys from that hold a word hidden alone, each
 * kept as written: Chat shows them anyway, and "Trader Joe's" must not read
 * "Trader someone's" because the owner paid a Joe through Zelle, nor "HBO
 * Max" read "HBO someone" because the owner has a category "Max".
 */
function shopsKept(people: PaymentPeople): Replacement[] {
  const alone = [
    ...people.loneAnyCase,
    ...people.loneNames,
    ...people.phrases.map(([phrase]) => phrase),
    ...people.labels.flatMap(({ words }) => words),
  ]
  const hidden = new Set(alone.flatMap(wordsOf))
  return [...people.shops.names]
    .filter((shop) => wordsOf(shop).some((word) => hidden.has(word)))
    .map((shop) => ({ pattern: fullNamePattern(shop), with: null }))
}

/** The names Chat hides that were read from labelled rows, in the order they are looked for. */
interface OfPeople {
  /** What labelled rows would have been shown as, and full names: looked for first. */
  phrases: Replacement[]
  /** Single words: one-word phrases, then words of names. */
  words: Replacement[]
}

/**
 * Each owner's label holding a word that could be a name, as it reads with
 * those words (and any other hidden name) as "someone", longest first, so
 * the label goes wherever it is written and its words nowhere else. The
 * whole name of a shop of two words or more stays ("Trader Joe's with Joe"
 * reads "Trader Joe's with someone"); a word that is or starts a shop's name
 * goes ("Ross allowance", "Ruby's Savings"). Labels of one word come apart,
 * looked for only after the shops kept, so a category "Max" leaves "HBO Max".
 */
function labelsAsShown(people: PaymentPeople, ofPeople: OfPeople): OfPeople {
  const shopsIn = (label: string) => {
    const plain = label.toLowerCase().replace(CURLY, "'")
    return [...people.shops.names]
      .filter((shop) => /\s/.test(shop) && plain.includes(shop))
      .map((shop) => ({ pattern: fullNamePattern(shop), with: null }))
  }
  const asSomeone = (words: readonly string[]) =>
    words.map((word) => ({ pattern: fullNamePattern(word), with: SOMEONE }))
  const shown = [...people.labels]
    .sort((a, b) => b.label.length - a.label.length)
    .flatMap(({ label, words }) => {
      const order = [...shopsIn(label), ...ofPeople.phrases, ...asSomeone(words), ...ofPeople.words]
      const reads = replacedIn(label, order)
      return reads === label ? [] : [{ label, pattern: fullNamePattern(label), with: reads }]
    })
  const oneWord = ({ label }: { label: string }) => !/\s/.test(label.trim())
  return {
    phrases: shown.filter((one) => !oneWord(one)),
    words: shown.filter(oneWord),
  }
}

/** What replaces each hidden thing, in the order they are looked for. */
function replacementsOf(people: PaymentPeople): Omit<Hidden, 'people'> {
  // A phrase of one word is a name alone ("Brightwater"), looked for after full names.
  const oneWord = ([phrase]: readonly [string, string]) => wordsOf(phrase).length === 1
  const phrases = people.phrases
    .filter((phrase) => !oneWord(phrase))
    .map(([phrase, label]) => ({ pattern: fullNamePattern(phrase), with: label }))
  const words = people.phrases
    .filter(oneWord)
    .map(([phrase]) => ({ pattern: fullNamePattern(phrase), with: SOMEONE }))
  const names = people.names
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ pattern: fullNamePattern(name), with: SOMEONE }))
  // A single word of the owner's account names is never hidden alone, so account names stay.
  const account = new Set(people.accountWords)
  const lone = [
    ...people.loneAnyCase.map((word) => ({ word, pattern: fullNamePattern(word) })),
    ...people.loneNames.map((word) => ({ word, pattern: loneNamePattern(word) })),
  ]
    .filter(({ word }) => !account.has(word.toLowerCase()))
    .map(({ pattern }) => ({ pattern, with: SOMEONE }))
  const ofPeople = { phrases: [...phrases, ...names], words: [...words, ...lone] }
  const labels = labelsAsShown(people, ofPeople)
  const masks = people.masks.map((mask) => ({ pattern: maskPattern(mask), with: MASKED }))
  return {
    names: [
      ...labels.phrases,
      ...ofPeople.phrases,
      ...shopsKept(people),
      ...labels.words,
      ...ofPeople.words,
    ],
    masks,
  }
}

/**
 * A tool's result as compact JSON for the chat model (every byte is paid
 * for, on every step), with every labelled row shown by its label and
 * everything in `people` replaced as each string is walked.
 */
export function chatToolText(result: unknown, people: PaymentPeople): string {
  const hidden: Hidden = { people, ...replacementsOf(people) }
  return agentJson(withoutBankText(walked(result, hidden)), { compact: true })
}
