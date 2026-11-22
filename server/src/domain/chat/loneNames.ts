// The parts of a hidden person's name that could be written alone in a note
// ("Dinner with Jane", "Doe, Jane"), so Chat can hide those too. Pure.
//
// A given name or surname alone is short and often a common word ("Will",
// "May", "Chase"), so these parts are only ever hidden in the owner's own
// notes, only where written with a capital, and never when they are a
// common word or how a known shop is called (chat/toolOutput.ts).

import { startsAShop, type KnownShops } from './knownShops.js'
import { isMovementWord } from './movementWords.js'

/**
 * Names that are also everyday words, months, days or banks. Written alone,
 * they far more often mean the word ("Electric bill, Will pay May 3") or the
 * bank ("Chase autopay") than the person, so they are never hidden alone.
 */
const COMMON_WORDS = new Set(
  (
    'january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'amber april art autumn baker banks best bill black bob bond brown buck bud cash chance ' +
    'chase chip cook daisy dawn dean drew duke earl faith fox frank gene gold golden grace ' +
    'grant gray green grey hall hill holly hope hunter iris ivy jack jade joy king lane ' +
    'lily little long love major mark max miles park pat pearl penny price ray rich rose ' +
    'ruby sky stone summer sunny ward wells white will winter wolf young ' +
    'ally amex capital chime citi discover fargo fifth navy regions third truist union'
  ).split(' '),
)

// One word of a name that reads as a given name or surname: letters, with an
// inner hyphen or apostrophe allowed ("Mary-Kate", "O'Neil").
const NAME_PART = /^\p{L}[\p{L}'-]*\p{L}$/u

/** A name part as it would start a sentence or a name: its first letter a capital. */
function capitalized(part: string): string {
  return part[0]!.toUpperCase() + part.slice(1)
}

/** Whether a word of a name could be hidden alone without hiding a common word or a shop. */
function hideableAlone(part: string, shops: KnownShops): boolean {
  return (
    NAME_PART.test(part) &&
    !isMovementWord(part) &&
    !COMMON_WORDS.has(part.toLowerCase()) &&
    !startsAShop(shops, part)
  )
}

/**
 * The given names and surnames of full names (two words or more), each
 * capitalized, to hide where written alone in a note. A name of one word is
 * hidden whole already, so it adds nothing here.
 */
export function loneNamesOf(fullNames: readonly string[], shops: KnownShops): string[] {
  const parts = fullNames.flatMap((name) => {
    const words = name.trim().split(/\s+/)
    return words.length < 2 ? [] : [words[0]!, words.at(-1)!]
  })
  return [...new Set(parts.filter((part) => hideableAlone(part, shops)).map(capitalized))]
}
