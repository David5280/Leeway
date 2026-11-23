// What of the rows Chat shows by name a note or label the owner wrote may
// hold, because the model sees it anyway (ownerText.ts): the shops' whole
// names ("Trader Joe's run"), and their words ("Marigold, order #1234") but
// for the ones a note far more often means as a person. Pure.

import { isNameAsWord } from './commonWords.js'
import type { KnownShops } from '../knownShops.js'
import { APOSTROPHES } from '../personShape.js'
import { wordsOf } from './billLabels.js'

// A shop named for someone: the given name before its "'s" ("Trader Joe's", "Sam's Club").
const OWNED_BY = new RegExp(`(\\p{L}+)[${APOSTROPHES}]s(?![\\p{L}\\p{M}])`, 'gu')

// Every apostrophe that is not a straight one, which shop names and notes are compared without.
const CURLY = new RegExp(`[${APOSTROPHES.replace("'", '')}]`, 'g')

/**
 * The words of the rows Chat shows by name (wordsOf), which a note or label
 * may hold: but no name that is also a word ("King" of King Soopers, "Max" of
 * HBO Max) and no given name a shop is named for ("Joe" of Trader Joe's,
 * "Wendy" of Wendy's), which a note far more often means as the person
 * ("birthday gift for Joe").
 */
export function shownWordsOf(texts: readonly string[]): Set<string> {
  const owners = new Set(
    texts.flatMap((text) => [...text.matchAll(OWNED_BY)].flatMap((match) => wordsOf(match[1]!))),
  )
  const words = texts.flatMap(wordsOf).filter((word) => !isNameAsWord(word) && !owners.has(word))
  return new Set(words)
}

/** Text as shop names are compared with it: every apostrophe a straight one. */
function straight(text: string): string {
  return text.replace(CURLY, "'")
}

/** A shop's name as a RegExp source matching it literally, any spaces between its words. */
function nameSource(name: string): string {
  const words = straight(name).trim().split(/\s+/)
  return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
}

// One pattern for each set of shops, since every note is read against them.
const PATTERNS = new WeakMap<KnownShops, RegExp | null>()

/**
 * The shops' names of two words or more as one pattern, longest first, or
 * null with none. A name of one word is left out: alone it may be a person
 * too ("Ross"), so its word is read as any other.
 */
function shopPattern(shops: KnownShops): RegExp | null {
  if (!PATTERNS.has(shops)) {
    const names = [...shops.names].filter((name) => /\s/.test(name.trim()))
    const sources = names.sort((a, b) => b.length - a.length).map(nameSource)
    const pattern = sources.length
      ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
      : null
    PATTERNS.set(shops, pattern)
  }
  return PATTERNS.get(shops)!
}

/**
 * A text without the whole names of the shops the owner buys from, which
 * Chat shows anyway: "Trader Joe's run" reads " run", so the "Joe" of a shop
 * is never read as a person, nor shown for one ("gift for Joe").
 */
export function withoutShops(text: string, shops: KnownShops): string {
  const pattern = shopPattern(shops)
  return pattern ? straight(text).replace(pattern, ' ') : text
}
