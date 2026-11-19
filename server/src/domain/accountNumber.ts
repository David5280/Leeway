// Account numbers in the names banks send, for accountName.ts. Pure.
//
// Banks put the account number in an account's name in many ways: "CHECKING
// ...4417", "CREDIT CARD (X4417)", "CHK417", "SAVINGS 44-17". Names leave the
// app, in the weekly email and to the AI writer, so the number must never be
// shown. Two layers keep it out:
//
// 1. withoutAccountNumber tidies the number out where it can, so most names
//    stay readable: "CHECKING ...4417" is "CHECKING".
// 2. carriesMask is the guarantee. accountName.ts checks every name built from
//    the bank's text with it, and a name that still carries the mask is thrown
//    away for one built only from what Leeway controls, like "Chase Checking".
//    So no rule in layer 1 has to be perfect for the number to stay hidden.

import { coreOf } from './nameWords.js'

/** Characters banks put in place of, or before, the digits: "XXXX", "*4417", "...4417", "#4417". */
const MASK_CHARACTERS = 'x*•·.…#-'

const MASK_CHARACTERS_AT_END = new RegExp(`[${MASK_CHARACTERS}]+$`, 'i')

/** Words that lead up to an account number, as in "ENDING IN 4417" or "(ACCT 4417)". */
const NUMBER_LEAD_INS = new Set(['account', 'acct', 'ending', 'in', 'no', 'num', 'number'])

/** The digits of a mask, "4417" from "4417" or "xx4417"; '' for none. */
function digitsOf(mask: string | null): string {
  return mask?.replace(/\D/g, '') ?? ''
}

/**
 * Whether a name still shows the account's mask, in any form a reader could
 * piece it back from. Each run of digits is read whole, joined across spaces,
 * hyphens and mask characters, so "44 17" and "4-4-1-7" are 4417. A run
 * carries the mask when it contains it ("044170"), is its last two digits or
 * more ("417" or "17" of 4417), or is the mask without its leading zeros ("52"
 * of 0052). A mask of one digit identifies nothing, so it is never looked for.
 */
export function carriesMask(name: string, mask: string | null): boolean {
  const digits = digitsOf(mask)
  if (digits.length < 2) return false
  const unpadded = digits.replace(/^0+/, '')
  const runs = name.match(/\d+(?:[\s*•·.…#x-]+\d+)*/gi) ?? []
  return runs.some((run) => {
    const joined = run.replace(/\D/g, '')
    if (joined.includes(digits) || joined === unpadded) return true
    return joined.length >= 2 && digits.endsWith(joined)
  })
}

/**
 * A bank's name for an account without the account number some banks put in
 * it, "CHECKING ...4417", "CREDIT CARD (X4417)" or "CHK417", and without the
 * words that led up to it, "ENDING IN" or "ACCT #". Tidying for looks only:
 * whatever it misses, carriesMask catches.
 */
export function withoutAccountNumber(bankName: string, mask: string | null): string {
  const maskDigits = digitsOf(mask)
  const words = joinedMask(bankName, maskDigits).split(/\s+/).filter(Boolean)
  const kept: string[] = []
  // Whether the word before was taken out as a number, like the XXXX of "XXXX 4417".
  let afterNumber = false
  words.forEach((word, index) => {
    // A bare run is the number when nothing follows it, or something led up to it.
    const last = index === words.length - 1
    const ledUpTo = afterNumber || (kept.length > 0 && leadsUpToNumber(kept.at(-1)!))
    const rest = withoutNumber(word, maskDigits, last || ledUpTo)
    afterNumber = rest !== null
    if (rest === null) {
      kept.push(word)
      return
    }
    // The number goes, and so do the words that led up to it: "CHECKING ACCT #".
    while (kept.length > 0 && isLeadIn(kept.at(-1)!)) kept.pop()
    // A word that ends by leading in keeps the word: "CHECKING:" is CHECKING.
    if (kept.length > 0) kept[kept.length - 1] = kept.at(-1)!.replace(/[:#]+$/, '')
    if (rest && !isLeadIn(rest)) kept.push(rest)
  })
  return balanced(kept.join(' '))
}

/**
 * The name with the mask written whole where a bank split it, "44-17" or
 * "44 17" for 4417, so it is found like any other. A mask of two digits split
 * up is joined only after a lead-in, as in "ACCT 5 2", since "1-2 YEAR CD" is
 * more likely a range; carriesMask catches any other.
 */
function joinedMask(bankName: string, maskDigits: string): string {
  if (maskDigits.length < 2) return bankName
  const digits = [...maskDigits].join('[-\\s]?')
  const leadIn =
    maskDigits.length >= 3
      ? ''
      : `(?<=(?:[:${MASK_CHARACTERS}]|\\b(?:${[...NUMBER_LEAD_INS].join('|')})\\.?)\\s*)`
  return bankName.replace(new RegExp(`${leadIn}(?<!\\d)${digits}(?!\\d)`, 'gi'), maskDigits)
}

/**
 * What is left of a word once its account number is taken out, or null when
 * it has none: "CHECKING-417" is CHECKING, and "(X4417)" is ''. A run is the
 * number when it has four digits or more (but a year like 2025 stays, unless
 * marked as a number or it is the mask), when it is the mask with or without
 * zeros in front ("052" for 52) and not a bare word that nothing led up to
 * with more of the name after it, or when mask characters lead into it and it
 * ends with the mask or is the mask's end ("...597" for 7597).
 *
 * A bare mask at the start or in the middle of a name, not led up to, stays:
 * that is how "12 MONTH CD" keeps its 12 when the mask is 12. carriesMask then
 * decides whether the name can be shown at all.
 */
function withoutNumber(word: string, maskDigits: string, standsAsNumber: boolean): string | null {
  const core = coreOf(word)
  // "XXXX" or "****" stands for digits too; the stars leave no core at all.
  if (/^[x*•]{2,}$/i.test(core || word)) return ''
  // Brackets around the number go, but not the mask characters before it: "(...417)" is "...417".
  const bare = word.replace(/[^\p{L}\p{N}]+$/u, '').replace(/^[([{"']+/, '')
  const bracketed = bare !== word
  for (const run of bare.matchAll(/\d+/g)) {
    const digits = run[0]
    const before = bare.slice(0, run.index)
    const after = bare.slice(run.index + digits.length)
    const marked = MASK_CHARACTERS_AT_END.test(before)
    const alone = bare === digits && !bracketed
    if (isNumber(digits, maskDigits, { marked, alone, standsAsNumber })) {
      return [withoutMaskCharacters(before), wordAfter(after)].filter(Boolean).join(' ')
    }
  }
  return null
}

/** Whether a run of digits in a word is the account number; see withoutNumber. */
function isNumber(
  digits: string,
  maskDigits: string,
  how: { marked: boolean; alone: boolean; standsAsNumber: boolean },
): boolean {
  // The mask, with or without zeros in front: "052" or "52" for 0052 or 52.
  const unpadded = (text: string) => text.replace(/^0+/, '')
  const isMask = maskDigits.length >= 2 && unpadded(digits) === unpadded(maskDigits)
  if (isMask) return !how.alone || how.standsAsNumber
  if (how.marked && maskDigits.length >= 2) {
    const endOfMask = digits.length >= 2 && maskDigits.endsWith(digits)
    if (digits.endsWith(maskDigits) || endOfMask) return true
  }
  const year = /^(19|20)\d\d$/.test(digits)
  return digits.length >= 4 && (!year || how.marked)
}

/** Text without the mask characters it ends with: "ACCT#" is ACCT, "CHECKINGX" is CHECKING. */
function withoutMaskCharacters(text: string): string {
  return text.replace(MASK_CHARACTERS_AT_END, '')
}

/**
 * What follows a number in the same word, kept when it is a word of its own:
 * "4417CHECKING" keeps CHECKING, but the "A" of "4417A" and the "(K" of "401(K)"
 * go with the number.
 */
function wordAfter(text: string): string {
  const word = text.replace(/^[^\p{L}\p{N}]+/u, '')
  return /^\p{L}{2,}$/u.test(word) && !/^x+$/i.test(word) ? word : ''
}

/** Punctuation alone, like "#:", a lone x, or a word like "ENDING" that leads up to a number. */
function isLeadIn(word: string): boolean {
  const core = coreOf(word)
  return core === '' || /^x$/i.test(core) || NUMBER_LEAD_INS.has(core.toLowerCase())
}

/** A word after which a bare number is the account's: a lead-in, or one ending in ":" or "#". */
function leadsUpToNumber(word: string): boolean {
  return isLeadIn(word) || /[:#]$/.test(word)
}

/**
 * Text without brackets of a kind that no longer pair up, like the "(" left
 * when "(ACCT" goes with its number.
 */
function balanced(text: string): string {
  let result = text
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    const opens = result.split(open).length
    const closes = result.split(close).length
    if (opens !== closes) result = result.replaceAll(open, '').replaceAll(close, '')
  }
  return result.replace(/\s+/g, ' ').trim()
}
