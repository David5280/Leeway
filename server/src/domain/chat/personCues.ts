// The words a person is named after in a label the owner wrote (ownerText.ts):
// kin, titles, roles and payment apps ("Uncle Bill", "Coach Bill", "Venmo
// June"), and the small words a person follows ("Gift for Rose", "Zelle to
// Ed"). Nothing vouches for a word right after one of them. Pure.

import { wordsOf } from './billLabels.js'

// Small words a person is named after ("gift for", "w/"), where nothing vouches.
const CONNECTORS = new Set(['for', 'with', 'w', 'to', 'from'])

// Words that name a person right after them, or after one of CONNECTORS
// ("Zelle to Ed"): kin, titles, roles and payment apps, of one word or two.
// "Doctor" is no role here, since "Doctor bill" far more often means the word.
const NAMERS = new Set([
  ...['uncle', 'aunt', 'cousin', 'grandma', 'grandpa', 'grandmother', 'grandfather', 'nana'],
  ...['brother', 'sister', 'son', 'daughter', 'wife', 'husband', 'friend', 'partner'],
  ...['boyfriend', 'girlfriend', 'fiance', 'fiancee', 'niece', 'nephew', 'mom', 'dad'],
  ...['mother', 'father', 'papa', 'mr', 'mrs', 'ms', 'dr', 'pastor', 'reverend'],
  // People paid by name for what they do ("Tutor Bill", "Coach Bill lessons").
  ...['coach', 'tutor', 'nanny', 'babysitter', 'sitter', 'teacher', 'trainer', 'instructor'],
  ...['mentor', 'therapist', 'counselor', 'caregiver', 'housekeeper', 'cleaner'],
  ...['neighbor', 'neighbour', 'landlord', 'landlady', 'roommate'],
  // "app" stands for Cash App.
  ...['venmo', 'zelle', 'paypal', 'chime', 'app', 'apple cash', 'square cash'],
])

// Every word of NAMERS, which is no one's itself ("Mrs", "Square").
const NAMER_WORDS = new Set([...NAMERS].flatMap((namer) => namer.split(' ')))

/** Whether a word (wordsOf, joined) is a word of NAMERS, so no one's itself. */
export function isNamerWord(word: string): boolean {
  return NAMER_WORDS.has(word)
}

/** Whether a written token is a word, unlike a number or a mark that parts a label. */
export const lettered = (word: string | undefined): boolean =>
  word !== undefined && /^\p{L}/u.test(word)

/** Where the nearest word is before (-1) or after (1) a written one, or -1 at an end. */
export function nearest(words: readonly string[], at: number, step: -1 | 1): number {
  for (let next = at + step; next >= 0 && next < words.length; next += step) {
    if (lettered(words[next])) return next
  }
  return -1
}

/** The word before a written word, alone and with the one before it ("cash", "apple cash"). */
interface Before {
  at: number
  one: string
  two: string
}

/** The words before a written word, or null when it starts the label. */
function wordsBefore(words: readonly string[], at: number): Before | null {
  const before = nearest(words, at, -1)
  if (before < 0) return null
  const one = wordsOf(words[before]!).join(' ')
  const earlier = nearest(words, before, -1)
  const two = earlier < 0 ? one : `${wordsOf(words[earlier]!).join(' ')} ${one}`
  return { at: before, one, two }
}

/** Whether words before one are kin, a title, a role or a payment app ("Uncle", "Apple Cash"). */
const byANamer = (before: Before | null): boolean =>
  before !== null && (NAMERS.has(before.one) || NAMERS.has(before.two))

/** Whether a written word follows one a person is named after ("for", "Uncle", "Venmo"). */
export function afterAPerson(words: readonly string[], at: number): boolean {
  const before = wordsBefore(words, at)
  return before !== null && (CONNECTORS.has(before.one) || byANamer(before))
}

/** Whether a written word follows a word of NAMERS, or one by "to" ("Zelle to Ed"). */
export function afterANamer(words: readonly string[], at: number): boolean {
  const before = wordsBefore(words, at)
  if (before === null) return false
  return byANamer(before) || (CONNECTORS.has(before.one) && byANamer(wordsBefore(words, before.at)))
}
