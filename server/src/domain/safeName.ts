// Transaction names that are safe to show anywhere: in the app, to AI
// assistants over MCP, to the AI writer and in email. Pure.
//
// A bank's text often names an account by its number: "ONLINE TRANSFER FROM
// CHK XXXXXX9876" names the owner's own checking account, and a transfer
// names the account at the other end, not the one it was posted to. So a
// name is checked against the masks of every account the owner has:
//
// 1. withoutAccountNumber (accountNumber.ts) tidies out each account's number
//    where it can, and every word with a run of four digits or more goes too,
//    since that reads as an account or reference number ("TRANSACTION#:3167").
// 2. carriesMask is the guarantee: a name that still shows any account's mask
//    is replaced by a plain fallback, like "Transfer".

import { asciiDigits, carriesMask, withoutAccountNumber } from './accountNumber.js'

/** The masks of every account the owner has, hidden ones included. */
export type AccountMasks = readonly (string | null)[]

/** A run of four digits or more, in any script, as an account or reference number reads. */
const LONG_NUMBER = /\d{4,}/

/** Punctuation left hanging at either end once a number goes: "Payment #", "- Thank you". */
const LOOSE_ENDS = /^[\s,:;#*.\-–]+|[\s,:;#*\-–]+$/g

/** The name without any word that holds a run of four digits or more. */
export function withoutLongNumbers(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => !LONG_NUMBER.test(asciiDigits(word)))
    .join(' ')
    .replace(LOOSE_ENDS, '')
}

/**
 * The name with every account number taken out, or the fallback when nothing
 * readable is left or the name still shows any account's mask.
 */
export function safeName(name: string, masks: AccountMasks, fallback: string): string {
  const tidied = masks.reduce<string>((text, mask) => withoutAccountNumber(text, mask), name)
  const safe = withoutLongNumbers(tidied)
  if (!/\p{L}/u.test(safe)) return fallback
  return masks.some((mask) => carriesMask(safe, mask)) ? fallback : safe
}
