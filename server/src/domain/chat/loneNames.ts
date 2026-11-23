// The parts of a hidden person's name that could be written alone ("Dinner
// with Jane", "DOE, JANE", "lunch with jane", a category "Kettering loan"),
// so Chat can hide those too. A hyphenated part is hidden whole and each of
// its parts alone ("Mary-Kate", "Mary", "Kate"). Pure.
//
// A part is never hidden when it is how a known shop is called, or a word
// businesses are named with (businessWords.ts). A longer part is hidden in
// any case; a short one only as a name is written, with a capital or in
// capitals. A common word ("Will", "May", "Rent") is a person
// only when an app's line named it as the person paid ("Zelle payment to
// RENT"), and even then only in the owner's notes, where they write about
// people: everywhere else it far more often means the word.

import { isBusinessWord } from '../businessWords.js'
import { isCommonWord } from './commonWords.js'
import { startsAShop, type KnownShops } from '../knownShops.js'
import { isMovementWord } from '../movementWords.js'
import { APOSTROPHES, isCredential } from '../personShape.js'

// One word of a name that reads as a given name, middle name or surname:
// letters, with an inner hyphen or apostrophe allowed ("Mary-Kate", "O'Neil", "O’Neil").
const NAME_PART = new RegExp(`^\\p{L}[\\p{L}${APOSTROPHES}-]*\\p{L}$`, 'u')

// The shortest part hidden in any case: shorter ones ("Al", "Bo", "Ann") are words too often.
const ANY_CASE_LENGTH = 4

/** A name to take parts from, and what may be hidden of it. */
export interface NameSource {
  name: string
  /** Named by an app's line as the person paid, so even a common word of it is them. */
  paid?: boolean
}

/** The single words Chat hides alone, and how. */
export interface LoneNames {
  /** Hidden only as written with a capital or in capitals. */
  capital: string[]
  /** Hidden in any case. */
  anyCase: string[]
  /** Common words, hidden only in notes, with a capital or in capitals. */
  inNotes: string[]
}

/** How a word of a name is hidden alone, or null when it is not. */
function hiddenAs(
  part: string,
  source: NameSource,
  shops: KnownShops,
  skip: ReadonlySet<string>,
): keyof LoneNames | null {
  if (!NAME_PART.test(part) || isMovementWord(part) || startsAShop(shops, part)) return null
  if (isCredential(part)) return null
  // A business's own words ("Insurance", "Lawn") are no one's, so a category keeps them.
  if (skip.has(part.toLowerCase()) || isBusinessWord(part)) return null
  if (isCommonWord(part)) return source.paid ? 'inNotes' : null
  return [...part].length >= ANY_CASE_LENGTH ? 'anyCase' : 'capital'
}

/** Whether a list holds a word already, in any case ("JANE" and "Jane" are one). */
function holds(words: readonly string[], word: string): boolean {
  return words.some((one) => one.toLowerCase() === word.toLowerCase())
}

/** A word of a name, and each part of it when hyphenated: "Mary-Kate", "Mary", "Kate". */
function partsOf(word: string): string[] {
  const pieces = word.split('-').filter(Boolean)
  return pieces.length > 1 ? [word, ...pieces] : [word]
}

/**
 * Every word of each name, given, middle and surname alike, and a name of
 * one word itself ("Quillon"), that can be hidden alone, with how.
 * Words in `skip` (the owner's own accounts, say) are never hidden alone.
 */
export function loneNamesOf(
  sources: readonly NameSource[],
  shops: KnownShops,
  skip: ReadonlySet<string> = new Set(),
): LoneNames {
  const found: LoneNames = { capital: [], anyCase: [], inNotes: [] }
  for (const source of sources) {
    for (const part of source.name.trim().split(/\s+/).flatMap(partsOf)) {
      const how = hiddenAs(part, source, shops, skip)
      if (how && !holds(found[how], part)) found[how].push(part)
    }
  }
  // A word hidden in any case needs no second, narrower pattern.
  const anyCase = new Set(found.anyCase.map((part) => part.toLowerCase()))
  return { ...found, capital: found.capital.filter((part) => !anyCase.has(part.toLowerCase())) }
}
