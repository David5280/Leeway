// A merchant's name reduced to what stays the same between charges, so repeat
// charges group together, a bill's pattern finds the payments and a pending
// charge finds the one it became. Pure.

import { cleanMerchantName, GENERIC_NAME, SMALL_WORDS, tidyMerchantName } from './merchantName.js'

/** What a charge is called: the bank's raw text, and the merchant's name when it gave one. */
interface MerchantText {
  merchantName: string | null
  name: string
}

/**
 * The merchant name reduced to its words: "NETFLIX.COM 8473 CA" and
 * "Netflix.com 1192 CA" both become "netflix com ca". The bank's merchant
 * name is read where it gave one, else its description. The SQL function
 * merchant_key() (migration 003) does the same for bills that read bank text.
 */
export function merchantKey(tx: MerchantText): string {
  return textKey(tx.merchantName ?? tx.name)
}

/** Any text reduced the same way: lower case, letters only, words split by single spaces. */
export function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

/**
 * The first word of a readable name (merchantName.ts), with a leading small
 * word like "the" skipped; '' when the name says nothing ("Bank transaction").
 */
function firstWord(name: string): string {
  if (name === GENERIC_NAME) return ''
  return (
    textKey(name)
      .split(' ')
      .find((word) => word !== '' && !SMALL_WORDS.has(word)) ?? ''
  )
}

/** The first word of the merchant name the bank gave, or '' without one. */
const givenWord = (tx: MerchantText) =>
  tx.merchantName ? firstWord(tidyMerchantName(tx.merchantName)) : ''

/**
 * The first word of the raw text, cleaned as for display, so processor codes
 * and card wording are gone first: "POS PURCHASE SHELL" gives "shell".
 */
const textWord = (tx: MerchantText) => firstWord(cleanMerchantName(tx.name))

/**
 * Whether two charges read as the same merchant, by the first word of the
 * merchant's name, so "Best Buy" is "Best Buy Co" while "SQ *BLUE BOTTLE" is
 * not "SQ *CORNER BAKERY". When the bank named the merchant on both, those
 * names decide. Otherwise either charge's merchant name or text may match
 * the other's. Loose on purpose: it only rules out a charge that otherwise
 * fits by account, amount and date.
 */
export function sameMerchant(a: MerchantText, b: MerchantText): boolean {
  if (a.merchantName && b.merchantName) {
    const word = givenWord(a)
    return word !== '' && word === givenWord(b)
  }
  const words = (tx: MerchantText) => [givenWord(tx), textWord(tx)].filter((word) => word !== '')
  const theirs = new Set(words(b))
  return words(a).some((word) => theirs.has(word))
}
