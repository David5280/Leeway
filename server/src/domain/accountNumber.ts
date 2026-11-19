// Account numbers in the names banks send, for accountName.ts. Pure.
//
// Banks put the account number in an account's name in many ways: "CHECKING
// ...4417", "CREDIT CARD (X4417)", "CHK417", "SAVINGS 44-17". Names leave the
// app, in the weekly email and to the AI writer, so the mask (the number's
// last 2 to 4 characters, as Plaid sends them) must never be shown, nor
// another account's, as a linked account's name may hold: "OVERDRAFT
// PROTECTION ...417". Two layers keep them out:
//
// 1. withoutAccountNumber tidies the number out where it can, so most names
//    stay readable: "CHECKING ...4417" is "CHECKING", and so does any marked
//    run of two digits or more, "...417". It reads ASCII digits only, and
//    misses some placements by design ("12 MONTH CD" keeps its 12).
// 2. carriesMask is the guarantee. accountName.ts checks every name built from
//    the bank's text with it, against the account's own mask and every other
//    account's mask of digits, and a name that carries one is thrown away
//    for one built only from what Leeway controls, like "Chase Checking". It
//    reads digits in any script or form, and splits runs on letters alone, so
//    no separator, "44 17", "441–7" or "441/7", hides a mask from it.
//
// What is guaranteed is exactly what carriesMask checks; see its comment.

import { coreOf } from './nameWords.js'

/** Characters banks put in place of, or before, the digits: "XXXX", "*4417", "...4417", "#4417". */
const MASK_CHARACTERS = 'x*•·.…#-'

const MASK_CHARACTERS_AT_END = new RegExp(`[${MASK_CHARACTERS}]+$`, 'i')

/** The same, but for a hyphen, which also joins words: "2-IN-1". */
const PLAIN_MASK_CHARACTERS_AT_END = /[x*•·.…#]+$/i

/** The dingbat digits, negative and plain circled 1 to 10: "❶" to "➓". */
const DINGBAT_DIGITS = /[\u2776-\u2793]/gu

/** Words that lead up to an account number, as in "ENDING IN 4417" or "(ACCT 4417)". */
const NUMBER_LEAD_INS = new Set(['account', 'acct', 'ending', 'in', 'no', 'num', 'number'])

/**
 * Text as the guarantee reads it: every digit written as 0 to 9, and letters
 * without their accents. NFKD folds fullwidth "４", math "𝟒", superscript "⁴"
 * and circled "④" to 4, and splits "Á" into A and an accent, which goes. The
 * dingbat digits "❹", "➃" and "➍", which NFKD leaves, are mapped by hand. A
 * digit of another script, like Arabic-Indic "٤" or Devanagari "४", is read
 * by its place in its run of ten, as Unicode lays out every set of decimal
 * digits.
 */
export function asciiDigits(text: string): string {
  const folded = text
    .replace(DINGBAT_DIGITS, (dingbat) => {
      // Three sets of 1 to 10 in a row, from U+2776.
      const place = (dingbat.codePointAt(0)! - 0x2776) % 10
      return String(place + 1)
    })
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
  return folded.replace(/\p{Nd}/gu, (digit) => {
    const point = digit.codePointAt(0)!
    let zero = point
    while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--
    return String((point - zero) % 10)
  })
}

/** A mask as compared: its letters and digits, in capitals and ASCII digits. */
function maskKey(mask: string | null): string {
  return asciiDigits(mask ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** The digits of a mask made only of digits, "4417"; '' for one with letters, or none. */
function digitsOf(mask: string | null): string {
  const key = maskKey(mask)
  return /^\d+$/.test(key) ? key : ''
}

/**
 * Whether a name carries the account's mask, in any form a reader could
 * piece it back from. This is the guarantee: a name for which it is false
 * shows none of the following.
 *
 * A mask of digits: the name's digits, in any script, are read in runs split
 * by letters alone, so spaces and any punctuation between digits join them:
 * "44 17", "441–7" and "441/7" are all 4417. A run carries the mask when it
 * contains it ("044170"), is its last two digits or more ("417" or "17" of
 * 4417), or is the mask without its leading zeros, when that leaves two
 * digits or more ("52" of 0052). A lone digit is never checked: "1" of 0001,
 * like a mask of one digit, identifies nothing.
 *
 * An x between digits may stand for one more, so the runs are read again
 * with it joining them, but only for what plainly reads as the number: the
 * whole mask, "441x7" or "3X9" for 39, or a run that mask characters lead
 * into, "...41x7". Otherwise the x is a letter, and "12X18" or "1X1" (for
 * 1111) carries nothing.
 *
 * A mask with letters, like 12AB: the name's letters and digits, in capitals
 * and without accents ("Á1" is A1), read as one string with everything else
 * taken out, and read again with an x between digits taken out too. It
 * carries the mask when either contains it ("CARD 12-AB" or "AB1x2"), or
 * when a word of it ends with the mask's last two characters or more, alone
 * or joined to the words before ("2AB", "TAB"). A mask's own x is kept, so
 * 1X2 is found in "1X 2" and "...X2".
 */
export function carriesMask(name: string, mask: string | null): boolean {
  const key = maskKey(mask)
  if (key.length < 2) return false
  const text = asciiDigits(name).toUpperCase()
  if (/^\d+$/.test(key)) return carriesDigits(text, key)
  return carriesCharacters(text, key) || carriesCharacters(joinedAtX(text), key)
}

/** Text in capitals without an X between digits: "441X7" is 4417. */
function joinedAtX(text: string): string {
  return text.replace(/(?<=\d)X(?=\d)/g, '')
}

/**
 * Whether a name carries another account's mask, which is held to less than
 * the account's own: its own name may hold another's mask by chance, "360
 * SAVINGS" beside a mask of 0360, so adding an account seldom renames one.
 * A mask of digits counts where it is written whole ("CHECKING 0360" or
 * "441x7"), and by its end only where marked as a number ("...360" or "#60").
 * A mask with letters and digits counts written whole, read as carriesMask
 * reads it ("X9Z1" or "X9-Z1"). A mask of letters alone is never counted: it
 * may be letters any word holds, and two such, NT and EY, would rule out
 * every name Leeway falls back to.
 */
export function carriesAnotherMask(name: string, mask: string | null): boolean {
  const key = maskKey(mask)
  if (key.length < 2 || !/\d/.test(key)) return false
  const text = asciiDigits(name).toUpperCase()
  if (/^\d+$/.test(key)) return carriesDigits(text, key, { ownMask: false })
  const lettersAndDigits = (read: string) => read.replace(/[^\p{L}\p{N}]+/gu, '')
  return [text, joinedAtX(text)].some((read) => lettersAndDigits(read).includes(key))
}

/**
 * carriesMask for a mask of digits only, or carriesAnotherMask where it is
 * not the account's own: then an unmarked run counts only with the whole mask.
 */
function carriesDigits(text: string, digits: string, { ownMask = true } = {}): boolean {
  const unpadded = digits.replace(/^0+/, '')
  const digitsIn = (run: string) => run.replace(/\D/g, '')
  const isMarked = (run: string) => /^[*•·.…#-]/.test(run.trim())
  const isWholeMask = (run: string) =>
    run.includes(digits) || (ownMask && unpadded.length >= 2 && run === unpadded)
  const carries = (run: string) => isWholeMask(run) || (run.length >= 2 && digits.endsWith(run))
  // Read first with each x a letter, then with it joining the digits around it.
  const split = text.split(/\p{L}+/u)
  const unmarkedCarries = ownMask ? carries : isWholeMask
  if (split.some((run) => (isMarked(run) ? carries : unmarkedCarries)(digitsIn(run)))) return true
  return joinedAtX(text)
    .split(/\p{L}+/u)
    .some((run) => (isMarked(run) ? carries : isWholeMask)(digitsIn(run)))
}

/** carriesMask for a mask with letters. */
function carriesCharacters(text: string, key: string): boolean {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const joined = words.join('')
  if (joined.includes(key)) return true
  // Each word's end, with the words before it joined on: "…CARD2AB" ends in 2AB.
  let end = 0
  return words.some((word) => {
    end += word.length
    const upToHere = joined.slice(0, end)
    for (let length = 2; length < key.length; length++) {
      if (upToHere.endsWith(key.slice(-length))) return true
    }
    return false
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
  const key = maskKey(mask)
  const words = joinedMask(bankName, maskDigits).split(/\s+/).filter(Boolean)
  const kept: string[] = []
  // Whether the word before was taken out as a number, like the XXXX of "XXXX 4417".
  let afterNumber = false
  words.forEach((word, index) => {
    // A bare run is the number when nothing follows it, or something led up to it.
    const last = index === words.length - 1
    const ledUpTo = afterNumber || (kept.length > 0 && leadsUpToNumber(kept.at(-1)!))
    const rest =
      withoutLetterMask(word, key, last || ledUpTo) ??
      withoutNumber(word, maskDigits, last || ledUpTo)
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
 * with more of the name after it, when mask characters lead into it and it
 * ends with the mask or is the mask's end ("...597" for 7597), or when it has
 * two digits or more and is marked as a number ("...417" or "#52"), since it
 * may be another account's mask.
 *
 * An x between digits stands for one more where that reads as the number:
 * "441x7" is 4417 for that mask, and "...41x7" for any. Otherwise the x is a
 * letter: "12X18" is 12 and 18, each weighed on its own.
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
  // Every digit of the word goes with the number, so "44x17" leaves no "44".
  const withoutRun = (index: number, length: number) => {
    const kept = withoutMaskCharacters(bare.slice(0, index).replace(/\d+/g, ''))
    return [kept, wordAfter(bare.slice(index + length))].filter(Boolean).join(' ')
  }
  for (const run of bare.matchAll(/\d+(?:x\d+)*/gi)) {
    const joined = run[0].replace(/x/gi, '')
    const markedAsNumber = isMarkedAsNumber(bare.slice(0, run.index))
    if (joined !== run[0] && joinsAtX(joined, maskDigits, markedAsNumber)) {
      return withoutRun(run.index, run[0].length)
    }
    for (const part of run[0].matchAll(/\d+/g)) {
      const digits = part[0]
      const index = run.index + part.index
      const before = bare.slice(0, index)
      const how = {
        marked: MASK_CHARACTERS_AT_END.test(before),
        markedPlainly: PLAIN_MASK_CHARACTERS_AT_END.test(before),
        markedAsNumber: isMarkedAsNumber(before),
        alone: bare === digits && !bracketed,
        standsAsNumber,
      }
      if (isNumber(digits, maskDigits, how)) return withoutRun(index, digits.length)
    }
  }
  return null
}

/**
 * Whether digits an x joins read as the account number: the whole mask is in
 * them, "441x7" for 4417, or they are marked as a number, "...41x7".
 */
function joinsAtX(joined: string, maskDigits: string, markedAsNumber: boolean): boolean {
  const unpadded = (text: string) => text.replace(/^0+/, '')
  const isMask = unpadded(joined).length >= 2 && unpadded(joined) === unpadded(maskDigits)
  return markedAsNumber || (maskDigits.length >= 2 && (joined.includes(maskDigits) || isMask))
}

/**
 * Whether what comes before a run marks it as an account number: dots, a
 * star or a "#" not after a digit ("...", "#", but not the "3." of "3.25"),
 * or an x standing on its own ("X417", but not the X of "MAX" or "12X18").
 */
function isMarkedAsNumber(before: string): boolean {
  return /(?:^|\P{N})[*•·.…#]+$/u.test(before) || /(?:^|[^\p{L}\p{N}])x+$/iu.test(before)
}

/** How a run of digits sits in its word, for isNumber. */
interface RunPlace {
  marked: boolean
  markedPlainly: boolean
  markedAsNumber: boolean
  alone: boolean
  standsAsNumber: boolean
}

/** Whether a run of digits in a word is the account number; see withoutNumber. */
function isNumber(digits: string, maskDigits: string, how: RunPlace): boolean {
  // The mask, with or without zeros in front: "052" or "52" for 0052 or 52.
  const unpadded = (text: string) => text.replace(/^0+/, '')
  if (maskDigits.length >= 2 && unpadded(digits) === unpadded(maskDigits)) {
    return isMaskNumber(digits !== maskDigits && unpadded(digits).length < 2, how)
  }
  // Marked as a number, it may be another account's mask; a lone digit identifies nothing.
  if (how.markedAsNumber && digits.length >= 2) return true
  if (how.marked && maskDigits.length >= 2) {
    const endOfMask = digits.length >= 2 && maskDigits.endsWith(digits)
    if (digits.endsWith(maskDigits) || endOfMask) return true
  }
  const year = /^(19|20)\d\d$/.test(digits)
  return digits.length >= 4 && (!year || how.marked)
}

/**
 * Whether a run that is the mask, with or without its zeros, is the number
 * where it sits. One down to a single digit once its zeros are off, the "1"
 * of 0001, is only the mask when plainly marked or led up to, so "1ST TIME"
 * and "2-IN-1" keep theirs; written in full, "CHK0001" is the mask as ever.
 */
function isMaskNumber(downToOneDigit: boolean, how: RunPlace): boolean {
  if (downToOneDigit) return how.markedPlainly || (how.alone && how.standsAsNumber)
  return !how.alone || how.standsAsNumber
}

/**
 * What is left of a word once a mask with letters is taken out of it, or null
 * when it shows none. The mask goes where it plainly starts: as the whole
 * word, "AB12" for AB12; after mask characters or digits, "CHK#AB12",
 * "XXXXAB12" or "0AB12"; or, for a mask that starts with a digit, after
 * letters too, "CHK12AB", as with "CHK417". A mask that starts with a letter
 * and runs on from a word's letters, NG in "CHECKING" or AS in "TEXAS", may
 * be the word's own, so it is left to the guarantee. A mask with digits also
 * goes by its end when that stands as a number: "2AB" for 12AB in "ENDING
 * 2AB". A mask of digits only is left to withoutNumber.
 */
function withoutLetterMask(word: string, key: string, standsAsNumber: boolean): string | null {
  if (key.length < 2 || /^\d+$/.test(key)) return null
  const bare = word.replace(/[^\p{L}\p{N}]+$/u, '').replace(/^[([{"']+/, '')
  const at = bare.toUpperCase().indexOf(key)
  if (at >= 0) {
    const before = bare.slice(0, at)
    const startsPlainly =
      /^\d/.test(key) || before === '' || /^x+$/i.test(before) || /[\d*•·.…#-]$/.test(before)
    if (!startsPlainly) return null
    const kept = withoutMaskCharacters(before.replace(/\d+/g, ''))
    return [kept, wordAfter(bare.slice(at + key.length))].filter(Boolean).join(' ')
  }
  if (!/\d/.test(key)) return null
  // Its end, marked or standing as a number: "x2AB", or "2AB" in "ENDING 2AB".
  // The x of a mask like 1X2 may be its own, so "...X2" is read with it too.
  const ends = [bare.replace(/^[x*•·.…#-]+/i, ''), bare.replace(/^[*•·.…#-]+/, '')]
  const isEnd = (end: string) => {
    const marked = end !== bare
    return end.length >= 2 && key.endsWith(end.toUpperCase()) && (marked || standsAsNumber)
  }
  return ends.some(isEnd) ? '' : null
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
