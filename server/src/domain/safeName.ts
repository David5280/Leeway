// Transaction names that are safe to show anywhere: in the app, to AI
// assistants over MCP, to the AI writer and in email. Pure.
//
// A bank's text often names an account by its number: "ONLINE TRANSFER FROM
// CHK XXXXXX9876" names the owner's own checking account, and a transfer
// names the account at the other end, not the one it was posted to. So a
// name is checked against the masks of every account the owner has:
//
// 1. withoutAccountNumber (accountNumber.ts) tidies out each account's number
//    where it can.
// 2. Every word that could be a number is dropped. Digits are read in any
//    script and counted across the letters between them, since "441X7" or
//    "4a4b1c7" still spells 4417 to a reader. A word goes when it holds four
//    digits or more ("TRANSACTION#:3167"), or when its digits joined spell
//    any account's mask or the mask's last two digits or more ("41X7").
// 3. carriesMask is the guarantee: a name that still shows any account's mask
//    is replaced by a plain fallback, like "Transfer".

import { asciiDigits, carriesMask, withoutAccountNumber } from './accountNumber.js'

/** The masks of every account the owner has, hidden ones included. */
export type AccountMasks = readonly (string | null)[]

/** How many digits a word may hold, letters between them ignored, before it reads as a number. */
const MOST_DIGITS_IN_A_WORD = 3

/** Punctuation left hanging at either end once a number goes: "Payment #", "- Thank you". */
const LOOSE_ENDS = /^[\s,:;#*.\-–]+|[\s,:;#*\-–]+$/g

/** A word's digits in ASCII, in order, with every letter and mark between them taken out. */
function digitsIn(word: string): string {
  return asciiDigits(word).replace(/\D/g, '')
}

/** The digits of a mask made only of digits, two or more; '' for one with letters. */
function maskDigits(mask: string | null): string {
  const digits = asciiDigits(mask ?? '').replace(/[^\p{L}\p{N}]/gu, '')
  return /^\d{2,}$/.test(digits) ? digits : ''
}

/**
 * Whether a word's digits, joined across letters, spell the mask: they hold
 * it ("044170"), are its last two digits or more ("41X7" for 4417), or are
 * the mask without its leading zeros ("5x2" for 0052).
 */
function spellsMask(digits: string, mask: string): boolean {
  if (digits.length < 2) return false
  const unpadded = mask.replace(/^0+/, '')
  return digits.includes(mask) || mask.endsWith(digits) || digits === unpadded
}

/** Whether a word could be read as an account or reference number. */
function readsAsNumber(word: string, masks: readonly string[]): boolean {
  const digits = digitsIn(word)
  if (digits.length > MOST_DIGITS_IN_A_WORD) return true
  return masks.some((mask) => spellsMask(digits, mask))
}

/** The name without any word that could be read as a number (see the top of this file). */
export function withoutNumberWords(name: string, masks: AccountMasks): string {
  const digitMasks = masks.map(maskDigits).filter(Boolean)
  return name
    .split(/\s+/)
    .filter((word) => !readsAsNumber(word, digitMasks))
    .join(' ')
    .replace(LOOSE_ENDS, '')
}

/**
 * The name with every account number taken out, or the fallback when nothing
 * readable is left or the name still shows any account's mask.
 */
export function safeName(name: string, masks: AccountMasks, fallback: string): string {
  const tidied = masks.reduce<string>((text, mask) => withoutAccountNumber(text, mask), name)
  const safe = withoutNumberWords(tidied, masks)
  if (!/\p{L}/u.test(safe)) return fallback
  return masks.some((mask) => carriesMask(safe, mask)) ? fallback : safe
}
