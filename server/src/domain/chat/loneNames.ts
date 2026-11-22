// The parts of a hidden person's name that could be written alone in a note
// ("Dinner with Jane", "DOE, JANE"), so Chat can hide those too. Pure.
//
// A name part alone is short and often a common word ("Will", "May",
// "Chase"), so these are only ever hidden in the owner's notes, where they
// write about people, only as written with a capital (chat/namePatterns.ts),
// and never when they are a common word or how a known shop is called.

import { isCommonWord } from './commonWords.js'
import { startsAShop, type KnownShops } from '../knownShops.js'
import { isMovementWord } from '../movementWords.js'

// One word of a name that reads as a given name, middle name or surname:
// letters, with an inner hyphen or apostrophe allowed ("Mary-Kate", "O'Neil", "O’Neil").
const NAME_PART = /^\p{L}[\p{L}'\u2019-]*\p{L}$/u

/** Whether a word of a name can be hidden alone without hiding a common word or a shop. */
function hideableAlone(part: string, shops: KnownShops): boolean {
  return (
    NAME_PART.test(part) &&
    !isMovementWord(part) &&
    !isCommonWord(part) &&
    !startsAShop(shops, part)
  )
}

/**
 * Every word of each name, given, middle and surname alike, and a name of
 * one word itself ("Bill"), that can be hidden alone in a note.
 */
export function loneNamesOf(names: readonly string[], shops: KnownShops): string[] {
  const parts = names.flatMap((name) => name.trim().split(/\s+/))
  return [...new Set(parts.filter((part) => hideableAlone(part, shops)))]
}
