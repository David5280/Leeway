// Whether a merchant name is shaped like a person's ("Odalys Larkspur",
// "DR. JANE DOE LCSW"), for labelling (modelLabels.ts). Plaid writes the
// person paid as the merchant on some lines, and a sole trader goes by
// their own name. Pure.

import { isCommonWord } from './chat/commonWords.js'
import { isBusinessWord } from './businessWords.js'
import { isMovementWord } from './movementWords.js'

// A word that could be a given name or surname: letters, with an inner
// hyphen or apostrophe ("Mary-Kate", "O'Neil"), but no possessive ("Joe's").
const NAME_WORD = /^\p{L}[\p{L}'’-]*\p{L}$/u
const POSSESSIVE = /['’]s$/i

// A middle initial, with or without its dot: "Jane Q. Doe".
const INITIAL = /^\p{L}\.?$/u

// A clinician's title or credential, anywhere in a line: "DR. JANE DOE", "JANE DOE LCSW".
const TITLE = /(?:^|[^\p{L}])(?:dr|lcsw|dds|dmd|phd|ph\.d|lpc|psyd|lmft|lmhc)(?:[^\p{L}]|$)/iu
// "MD" after a name: "JANE DOE MD", "Jane Doe, M.D.". Alone it is too often Maryland.
const TRAILING_MD = /[\s,]+m\.?d\.?\s*$/i

/** Whether a word is an everyday one, never a name to hide: a common, business or movement word. */
export function isEverydayWord(word: string): boolean {
  return isCommonWord(word) || isBusinessWord(word) || isMovementWord(word)
}

/** Whether one word could be part of a person's name and is no everyday or business word. */
function couldBeANameWord(word: string): boolean {
  return NAME_WORD.test(word) && !POSSESSIVE.test(word) && !isEverydayWord(word)
}

/** Whether a text has words and every one is an everyday word ("Rent", "House cleaner"). */
export function onlyEverydayWords(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  return words.length > 0 && words.every(isEverydayWord)
}

/**
 * Whether a name has the shape of a person's: two name words ("Jane Doe"),
 * or two around a middle initial ("Jane Q. Doe"), none of them an everyday
 * or business word ("King Soopers", "Taco Bell" and "Joe's Pizza" are not).
 */
export function hasAPersonsShape(name: string): boolean {
  const words = name.trim().split(/\s+/)
  if (words.length === 3 && INITIAL.test(words[1]!)) words.splice(1, 1)
  return words.length === 2 && words.every(couldBeANameWord)
}

/** Whether a line or merchant reads as a clinician by name: a title, or a name then "MD". */
export function namesAClinician(text: string): boolean {
  if (TITLE.test(text)) return true
  return TRAILING_MD.test(text) && hasAPersonsShape(text.replace(TRAILING_MD, ''))
}
