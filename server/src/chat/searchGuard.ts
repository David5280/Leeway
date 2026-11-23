// Keeps a model's search from confirming a hidden name by its count. Pure.
//
// list_transactions and preview_rule match a text and say how many rows
// hold it, so even with every labelled row relabelled, searching "prycewood"
// and getting 3 would show that someone of that name was paid. Such a search
// is refused with a plain message: one that could find a hidden name, or text
// only a labelled row's hidden name or line holds, unless it is a shop's.

import { wordsOf } from '../domain/chat/billLabels.js'
import { isCommonWord } from '../domain/chat/commonWords.js'
import type { PaymentPeople } from '../domain/chat/people.js'

/** The tools that match a text, and the field of their input that holds it. */
const SEARCHED: Readonly<Record<string, string>> = {
  list_transactions: 'search',
  preview_rule: 'pattern',
}

/** What the model hears instead of a result. */
export const HIDDEN_SEARCH_MESSAGE =
  'That text is only in payments shown without their name, so it cannot be searched. ' +
  'Search by category, amount, date or the label shown instead.'

// The shortest search looked for inside hidden text: "jo" would refuse too much.
const PART_LENGTH = 3

/**
 * Whether a search could find a hidden name, accents aside: it is one, or a
 * part of one ("halvor"), or holds one as a whole word ("ingrid halvorsen").
 * Only as a whole word, so "sam" hidden never refuses "samsung". A common
 * word ("Max") is a name only alone, so "hbo max" is no search for one.
 */
function findsName(text: string, people: PaymentPeople): boolean {
  const search = text.normalize('NFKD').replace(/\p{M}/gu, '')
  const words = new Set(wordsOf(search))
  return people.hiddenWords.some(
    (word) =>
      word === search ||
      (search.length >= PART_LENGTH && word.includes(search)) ||
      (words.has(word) && !isCommonWord(word)),
  )
}

/**
 * Whether a search is for a shop the owner buys from: its name, the start of
 * it, or its name and more ("costco", "cost", "costco whse"). A shop's name
 * shows on its rows, so a row of it shown by a label hides no one.
 */
function findsAShop(search: string, people: PaymentPeople): boolean {
  return [...people.shops.names].some((shop) => shop.startsWith(search) || search.startsWith(shop))
}

/** Whether a search finds text a labelled row hides that its label does not show. */
function findsHiddenText(search: string, people: PaymentPeople): boolean {
  if (search.length < PART_LENGTH || findsAShop(search, people)) return false
  return people.hiddenTexts.some(
    ({ text, label }) => text.includes(search) && !label.includes(search),
  )
}

/**
 * Why a tool call may not run, as the model should hear it, or null when it
 * may: it searches for text that could confirm a hidden name.
 */
export function refusedSearch(tool: string, input: unknown, people: PaymentPeople): string | null {
  const field = SEARCHED[tool]
  if (!field || input === null || typeof input !== 'object') return null
  const value = (input as Record<string, unknown>)[field]
  const search = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!search) return null
  return findsName(search, people) || findsHiddenText(search, people) ? HIDDEN_SEARCH_MESSAGE : null
}
