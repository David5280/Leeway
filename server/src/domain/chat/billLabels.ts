// Which of the owner's bills Chat shows by a label, because what they track
// is shown by one (modelLabels.ts), and whether their name goes too. Pure.
//
// A bill's pattern is part of the line it pays, so for a bill paying a
// person it is that person's name ("prycewood"). Such a bill never shows its
// pattern. Its name is the owner's own words, and often the person's too
// ("Hawthorne"), so it is shown as the label unless it is made only of
// everyday words ("Rent", "Cleaner") and reads as no app's or transfer's line.

import { isBusinessWord } from '../businessWords.js'
import { textKey } from '../merchantKey.js'
import { neutralLabel, readsAsLabelled } from '../modelLabels.js'
import { isMovementWord } from '../movementWords.js'
import type { RuleReads } from '../rules.js'
import { isCommonWord } from './commonWords.js'

/** A bill as stored, as labelling reads it. */
export interface StoredBill {
  id: string
  name: string
  matchPattern: string | null
  reads: RuleReads
}

/** A labelled payment out, by the keys a bill's pattern is looked for in. */
export interface LabelledPayment {
  label: string
  /** Its merchant name and line together (bankTextKey), for a bill that reads bank text. */
  bankKey: string
  /** Its shown name as a key, for a bill an assistant patterned. */
  shownKey: string
}

/** How a label bill is shown. */
export interface BillShown {
  label: string
  /** Whether its name is shown as the label too, and replaced by it wherever written. */
  renamed: boolean
}

/** Whether a key holds a pattern's words whole: "chase" is in "to chase card", never in "purchase". */
function holdsWords(key: string, pattern: string): boolean {
  return ` ${key} `.includes(` ${pattern} `)
}

/** The label a text that reads as labelled (readsAsLabelled) has alone, as a payment out. */
function textLabel(text: string): string {
  const row = { name: text, merchantName: null, amountCents: 1 }
  const codes = { providerCategoryPrimary: null, providerCategoryDetailed: null }
  return neutralLabel({ ...row, ...codes })!.label
}

/** A text's words in lower case without accents: "Núñez, Ana" reads "nunez", "ana". */
export function wordsOf(text: string): string[] {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  return plain.split(/[^\p{L}]+/u).filter(Boolean)
}

/** Whether any word of a text is one of the hidden names' words (wordsOf). */
function namesHidden(text: string, hiddenWords: ReadonlySet<string>): boolean {
  return wordsOf(text).some((word) => hiddenWords.has(word))
}

/**
 * The label a bill is shown by, or null when it shows as it is. A bill gets
 * one when its pattern, as whole words, is in a labelled payment's line (the
 * label is that payment's), or when its pattern or name reads as a payment
 * app's or a transfer's line, or its pattern names a hidden person.
 */
function labelOf(
  bill: StoredBill,
  payments: readonly LabelledPayment[],
  hiddenWords: ReadonlySet<string>,
): string | null {
  const pattern = bill.matchPattern ? textKey(bill.matchPattern) : ''
  const key = bill.reads === 'shown_name' ? 'shownKey' : 'bankKey'
  const paid = pattern && payments.find((payment) => holdsWords(payment[key], pattern))
  if (paid) return paid.label
  const text = [bill.matchPattern, bill.name].find((one) => one && readsAsLabelled(one))
  if (text) return textLabel(text)
  return bill.matchPattern && namesHidden(bill.matchPattern, hiddenWords) ? 'Payment sent' : null
}

/** Whether a word is an everyday one, never a name to hide: a common, business or movement word. */
function isEveryday(word: string): boolean {
  return isCommonWord(word) || isBusinessWord(word) || isMovementWord(word)
}

/** Whether a text holds a full name's words in a row: "ally auto loan" holds "Ally Auto". */
function holdsName(text: string, names: readonly string[]): boolean {
  const spaced = ` ${wordsOf(text).join(' ')} `
  return names.some((name) => spaced.includes(` ${wordsOf(name).join(' ')} `))
}

/**
 * Whether a label bill keeps its own name: one made only of everyday words
 * ("Rent", "Cleaner", "Car payment") that hold no hidden name or word and do
 * not read as an app's or a transfer's line.
 */
function keepsItsName(name: string, hidden: HiddenInBills): boolean {
  if (readsAsLabelled(name) || namesHidden(name, hidden.words)) return false
  const words = wordsOf(name)
  return words.length > 0 && words.every(isEveryday) && !holdsName(name, hidden.names)
}

/** The hidden names a bill's name is checked against. */
interface HiddenInBills {
  /** The hidden names' words (wordsOf). */
  words: ReadonlySet<string>
  /** The full names hidden, as written. */
  names: readonly string[]
}

/**
 * Every bill shown by a label, by id. `hiddenWords` are the hidden names'
 * words (wordsOf), and `hiddenNames` the full names. A bill keeps its name
 * only when keepsItsName says so; any other is renamed to its label.
 */
export function labelBills(
  bills: readonly StoredBill[],
  payments: readonly LabelledPayment[],
  hiddenWords: ReadonlySet<string>,
  hiddenNames: readonly string[] = [],
): Map<string, BillShown> {
  const hidden = { words: hiddenWords, names: hiddenNames }
  const shown = new Map<string, BillShown>()
  for (const bill of bills) {
    const label = labelOf(bill, payments, hiddenWords)
    if (!label) continue
    shown.set(bill.id, { label, renamed: !keepsItsName(bill.name, hidden) })
  }
  return shown
}
