// The whole names of the shops Chat shows by name, which a label the owner
// wrote may hold as written ("Trader Joe's run", ownerText.ts): only a
// whole name vouches, never one of its words ("Joe" of Trader Joe's, "Max"
// of HBO Max), which a label far more often means as a person. Pure.

import type { KnownShops } from '../knownShops.js'
import { APOSTROPHES } from '../personShape.js'

// Every apostrophe that is not a straight one, which shop names and labels are compared without.
const CURLY = new RegExp(`[${APOSTROPHES.replace("'", '')}]`, 'g')

/** Text as shop names are compared with it: every apostrophe a straight one. */
export function straight(text: string): string {
  return text.replace(CURLY, "'")
}

/** A shop's name as a RegExp source matching it literally, any spaces between its words. */
function nameSource(name: string): string {
  const words = straight(name).trim().split(/\s+/)
  return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
}

// One pattern for each set of shops, since every label is read against them.
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
 * is never read as a person, while "gift for Joe" still is. Each name is
 * replaced by `standIn`, a space unless the reader marks where a shop was.
 */
export function withoutShops(text: string, shops: KnownShops, standIn = ' '): string {
  const pattern = shopPattern(shops)
  return pattern ? straight(text).replace(pattern, standIn) : text
}
