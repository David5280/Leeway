// Account numbers in bank names: the tidying that takes them out, the check
// that guarantees none is shown, and a table crossing masks, placements and
// real words to hold the guarantee across every way a bank writes a number.

import { describe, expect, it } from 'vitest'
import { accountDisplayName, type AccountNameParts } from '../src/domain/accountName.js'
import { asciiDigits, carriesMask, withoutAccountNumber } from '../src/domain/accountNumber.js'
import { isShouted, readableCase } from '../src/domain/nameWords.js'

describe('withoutAccountNumber', () => {
  it('takes out a long number however the bank marks it, with what led up to it', () => {
    const tidied = (bankName: string) => withoutAccountNumber(bankName, '4417')
    expect(tidied('CHECKING ...4417')).toBe('CHECKING')
    expect(tidied('CREDIT CARD (X4417)')).toBe('CREDIT CARD')
    expect(tidied('SAVINGS XXXX-4417')).toBe('SAVINGS')
    expect(tidied('CHECKING ENDING IN 4417')).toBe('CHECKING')
    expect(tidied('Checking *4417')).toBe('Checking')
    expect(tidied('CHECKING (ACCT 4417)')).toBe('CHECKING')
    expect(tidied('CHECKING [ACCT #4417]')).toBe('CHECKING')
    expect(tidied('CHECKING #: 4417')).toBe('CHECKING')
    expect(tidied('CREDIT CARD XXXX XXXX XXXX 4417')).toBe('CREDIT CARD')
    expect(tidied('CHECKING **** 4417')).toBe('CHECKING')
    expect(tidied('CHECKING-4417')).toBe('CHECKING')
    expect(tidied('SAVINGS (ACCT4417)')).toBe('SAVINGS')
    expect(tidied('SAVINGS NO. 4417')).toBe('SAVINGS')
    expect(tidied('MY ACCT 1234567890')).toBe('MY')
    expect(withoutAccountNumber('CHECKING ...9921', null)).toBe('CHECKING')
  })

  it('takes out the mask after a lead-in, keeping the words after it', () => {
    expect(withoutAccountNumber('CHECKING ACCT 352 PLUS', '352')).toBe('CHECKING PLUS')
    expect(withoutAccountNumber('CHECKING # 52 REWARDS', '52')).toBe('CHECKING REWARDS')
    expect(withoutAccountNumber('CHECKING ENDING IN 52 2025', '52')).toBe('CHECKING 2025')
    expect(withoutAccountNumber('CHECKING NO. 61 6 MO', '61')).toBe('CHECKING 6 MO')
    expect(withoutAccountNumber('CHECKING X 352 TOP 10', '352')).toBe('CHECKING TOP 10')
    expect(withoutAccountNumber('CHECKING - 352 6 MO', '352')).toBe('CHECKING 6 MO')
    expect(withoutAccountNumber('CHECKING: 165 529', '165')).toBe('CHECKING 529')
  })

  it('takes out a short mask glued, bracketed, marked or last', () => {
    expect(withoutAccountNumber('CHECKING 417', '417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING-417', '417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING (417)', '417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ACCT#417', '417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING #417 PLUS', '417')).toBe('CHECKING PLUS')
    expect(withoutAccountNumber('SAVINGS 12', '12')).toBe('SAVINGS')
    expect(withoutAccountNumber('CHECKING X12', '12')).toBe('CHECKING')
    // Glued to letters: what is left is a word or nothing, never the digits.
    expect(withoutAccountNumber('CHK417', '417')).toBe('CHK')
    expect(withoutAccountNumber('CHECKINGX4417', '4417')).toBe('CHECKING')
  })

  it('takes out a marked run that ends with the mask or is its end', () => {
    expect(withoutAccountNumber('SAVINGS ...052', '52')).toBe('SAVINGS')
    expect(withoutAccountNumber('CC x012', '12')).toBe('CC')
    expect(withoutAccountNumber('SAVINGS ...597', '7597')).toBe('SAVINGS')
  })

  it('joins a mask the bank split, a short one only after a lead-in', () => {
    expect(withoutAccountNumber('CHECKING 44-17', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING 44 17', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING X 5-2', '52')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ACCT 5 2', '52')).toBe('CHECKING')
    // Unled, "5 2" may be the name's own; the guarantee decides (see accountName.test.ts).
    expect(withoutAccountNumber('1-2 YEAR CD', '12')).toBe('1-2 YEAR CD')
  })

  it('keeps a year and the words after a number, but not stray letters', () => {
    expect(withoutAccountNumber('CHECKING 2025', '4417')).toBe('CHECKING 2025')
    expect(withoutAccountNumber('CHECKING 2025', '2025')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ...2025', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('4417CHECKING', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING 4417A', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('ROTH 401(K)', '401')).toBe('ROTH')
  })

  it('keeps digits that are only part of the name', () => {
    expect(withoutAccountNumber('12 MONTH CD', '12')).toBe('12 MONTH CD')
    expect(withoutAccountNumber('ACME 401K', '01')).toBe('ACME 401K')
    expect(withoutAccountNumber('PLAN 401', '01')).toBe('PLAN 401')
    expect(withoutAccountNumber('PLATINUM X2', '12')).toBe('PLATINUM X2')
  })

  it('takes out a lone x, star or # that led up to the number', () => {
    expect(withoutAccountNumber('CHECKING X 4417', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING * 4417', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING # 4417', '4417')).toBe('CHECKING')
  })

  it('drops a bracket left open once the number goes, and keeps pairs', () => {
    expect(withoutAccountNumber('CHECKING [ACCT 4417', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING (ACCT 4417', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('PLUS (SAVINGS) ...4417', '4417')).toBe('PLUS (SAVINGS)')
    // A close with no open is dropped the same way.
    expect(withoutAccountNumber('CHECKING ACCT 4417] PLUS', '4417')).toBe('CHECKING PLUS')
    expect(withoutAccountNumber('PLUS (SAVINGS ...4417)', '4417')).toBe('PLUS SAVINGS')
  })

  it('takes every digit of the word the number is in', () => {
    expect(withoutAccountNumber('CHECKING 44x17', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHK44*17', '4417')).toBe('CHK')
  })

  it('takes a one-digit mask, once its zeros are off, only where plainly marked or led up to', () => {
    expect(withoutAccountNumber('1ST TIME CHECKING', '01')).toBe('1ST TIME CHECKING')
    expect(withoutAccountNumber('PLATINUM 2-IN-1 CARD', '0001')).toBe('PLATINUM 2-IN-1 CARD')
    expect(withoutAccountNumber('CHECKING X1', '0001')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ENDING IN 1', '01')).toBe('CHECKING')
  })

  it('takes out a mask with letters, whole or its end', () => {
    expect(withoutAccountNumber('CARD AB12', 'AB12')).toBe('CARD')
    expect(withoutAccountNumber('CARD ending 2AB', '12AB')).toBe('CARD')
    expect(withoutAccountNumber('CARD x2AB PLUS', '12AB')).toBe('CARD PLUS')
    expect(withoutAccountNumber('CARDX9Z1', 'X9Z1')).toBe('CARD')
    expect(withoutAccountNumber('CARD (ab12)', 'AB12')).toBe('CARD')
    // Its end, unmarked and with more of the name after it, is left to the guarantee.
    expect(withoutAccountNumber('TAB CARD', '12AB')).toBe('TAB CARD')
  })
})

describe('asciiDigits', () => {
  it('writes digits of every form and script as 0 to 9', () => {
    expect(asciiDigits('４４１７')).toBe('4417')
    expect(asciiDigits('𝟒𝟒𝟏𝟕')).toBe('4417')
    expect(asciiDigits('⁴⁴¹⁷')).toBe('4417')
    expect(asciiDigits('④④①⑦')).toBe('4417')
    expect(asciiDigits('٤٤١٧')).toBe('4417')
    expect(asciiDigits('۴۴۱۷')).toBe('4417')
    expect(asciiDigits('४४१७')).toBe('4417')
    expect(asciiDigits('๔๔๑๗')).toBe('4417')
    expect(asciiDigits('Checking ٠٩')).toBe('Checking 09')
  })
})

describe('carriesMask', () => {
  it('finds the mask in a run of digits, or the end of it', () => {
    expect(carriesMask('Checking 4417', '4417')).toBe(true)
    expect(carriesMask('Checking 044170', '4417')).toBe(true)
    expect(carriesMask('Checking 417', '4417')).toBe(true)
    expect(carriesMask('Checking 17', '4417')).toBe(true)
    expect(carriesMask('Checking 52', '0052')).toBe(true)
    expect(carriesMask('Checking 1111', '1111')).toBe(true)
  })

  it('joins digits across anything but letters', () => {
    for (const between of [
      ' ',
      '-',
      '*',
      '/',
      '_',
      ',',
      ':',
      '+',
      '(',
      ')',
      '‐',
      '‑',
      '‒',
      '–',
      '−',
    ])
      expect(carriesMask(`Checking 441${between}7`, '4417')).toBe(true)
    expect(carriesMask('Checking 4 4 1 7', '4417')).toBe(true)
    expect(carriesMask('Checking 5 2', '52')).toBe(true)
  })

  it('reads digits of any form or script', () => {
    expect(carriesMask('CHECKING ４４１７', '4417')).toBe(true)
    expect(carriesMask('CHECKING ٤٤١٧', '4417')).toBe(true)
    expect(carriesMask('CHECKING ४४१७', '4417')).toBe(true)
    expect(carriesMask('CHECKING 𝟒𝟒𝟏𝟕', '4417')).toBe(true)
    expect(carriesMask('CHECKING ⁴¹⁷', '4417')).toBe(true)
    expect(carriesMask('CHECKING ④①⑦', '4417')).toBe(true)
    expect(carriesMask('CHECKING 4417', '４４１７')).toBe(true)
  })

  it('splits runs at letters, so a letter between digits never hides the end of the mask', () => {
    expect(carriesMask('Checking 44x17', '4417')).toBe(true)
    expect(carriesMask('Top 10 Checking', '4417')).toBe(false)
  })

  it('finds a mask with letters whole, split, or by its end', () => {
    expect(carriesMask('Card AB12', 'AB12')).toBe(true)
    expect(carriesMask('Card ab-12', 'AB12')).toBe(true)
    expect(carriesMask('Card ending 2AB', '12AB')).toBe(true)
    expect(carriesMask('Card 2 AB', '12AB')).toBe(true)
    expect(carriesMask('Card Tab', '12AB')).toBe(true)
    expect(carriesMask('Card ４AB', 'X4AB')).toBe(true)
    expect(carriesMask('Card 12', 'AB12')).toBe(true)
    expect(carriesMask('Card Plus', '12AB')).toBe(false)
    expect(carriesMask('Card 2', '12AB')).toBe(false)
  })

  it('passes other digits, a lone digit, a one-digit mask and no mask', () => {
    expect(carriesMask('12 Month CD', '4417')).toBe(false)
    expect(carriesMask('Checking 7', '4417')).toBe(false)
    expect(carriesMask('Checking 41', '4417')).toBe(false)
    expect(carriesMask('1st Time Checking', '01')).toBe(false)
    expect(carriesMask('Checking 5', '0005')).toBe(false)
    expect(carriesMask('Top 10', '7')).toBe(false)
    expect(carriesMask('Checking 4417', null)).toBe(false)
    expect(carriesMask('Checking', '4417')).toBe(false)
  })
})

// The table: every mask crossed with every way a bank writes it and every real
// word before or after, deterministic, with no randomness.

/** Masks of two to four characters: a leading zero, a year, repeated digits, and letters. */
const MASKS = ['52', '417', '4417', '0352', '2025', '1111', '12AB', 'X9Z1']

/** Characters a bank might put between the halves of a mask. */
const SEPARATORS = ['/', '_', ',', ':', '+', '(', ')', '‐', '‑', '‒', '–', '−']

/** The zero of each set of digits the table writes, beyond ASCII. */
const ZEROS = { arabicIndic: 0x660, extendedArabicIndic: 0x6f0, devanagari: 0x966, thai: 0xe50 }

/** Each digit of a mask in another set of digits, letters as they are. */
function inDigits(mask: string, zero: number): string {
  return mask.replace(/\d/g, (digit) => String.fromCodePoint(zero + Number(digit)))
}

/** Each way a bank might write the mask into "CHECKING", as a whole name. */
function placements(mask: string): Record<string, string> {
  const [head, tail] = [mask.slice(0, mask.length / 2), mask.slice(mask.length / 2)]
  const end = mask.slice(-Math.max(2, mask.length - 1))
  const written = (digits: (digit: string) => string) => mask.replace(/\d/g, digits)
  return {
    bare: `CHECKING ${mask}`,
    bracketed: `CHECKING (${mask})`,
    squareBracketed: `CHECKING [${mask}]`,
    glued: `CHECKING${mask}`,
    gluedShort: `CHK${mask}`,
    gluedX: `CHECKINGX${mask}`,
    gluedLetterAfter: `CHECKING ${mask}A`,
    hyphenated: `CHECKING-${mask}`,
    spacedHyphen: `CHECKING - ${mask}`,
    hash: `CHECKING #${mask}`,
    spacedHash: `CHECKING # ${mask}`,
    x: `CHECKING X${mask}`,
    lowerX: `CHECKING x${mask}`,
    spacedX: `CHECKING X ${mask}`,
    star: `CHECKING *${mask}`,
    spacedStar: `CHECKING * ${mask}`,
    stars: `CHECKING ****${mask}`,
    dots: `CHECKING ...${mask}`,
    ellipsis: `CHECKING …${mask}`,
    maskedGroups: `CHECKING XXXX-${mask}`,
    spacedGroups: `CHECKING XXXX XXXX ${mask}`,
    acct: `CHECKING ACCT ${mask}`,
    acctHash: `CHECKING ACCT#${mask}`,
    acctSpacedHash: `CHECKING ACCT #${mask}`,
    acctColon: `CHECKING ACCT: ${mask}`,
    no: `CHECKING NO. ${mask}`,
    number: `CHECKING NUMBER ${mask}`,
    endingIn: `CHECKING ENDING IN ${mask}`,
    colon: `CHECKING: ${mask}`,
    bracketedAcct: `CHECKING (ACCT ${mask})`,
    openBracket: `CHECKING [ACCT ${mask}`,
    bracketedX: `CHECKING (X${mask})`,
    splitHyphen: `CHECKING ${head}-${tail}`,
    splitSpace: `CHECKING ${head} ${tail}`,
    splitAfterX: `CHECKING X ${head} ${tail}`,
    truncated: `CHECKING ...${end}`,
    zeroPadded: `CHECKING ...0${mask}`,
    zeroPaddedBare: `CHECKING 0${mask}`,
    mixedCase: `Checking ending in ${mask}`,
    mixedCaseAcct: `Checking acct ${mask}`,
    lettersInside: `CHECKING ${head}x${tail}`,
    ...Object.fromEntries(
      SEPARATORS.map((separator, index) => [
        `split${index}`,
        `CHECKING ${head}${separator}${tail}`,
      ]),
    ),
    fullwidth: `CHECKING ${written((d) => String.fromCodePoint(0xff10 + Number(d)))}`,
    mathBold: `CHECKING ${written((d) => String.fromCodePoint(0x1d7ce + Number(d)))}`,
    superscript: `CHECKING ${written((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)}`,
    circled: `CHECKING ${written((d) => '⓪①②③④⑤⑥⑦⑧⑨'[Number(d)]!)}`,
    ...Object.fromEntries(
      Object.entries(ZEROS).map(([script, zero]) => [script, `CHECKING ${inDigits(mask, zero)}`]),
    ),
  }
}

/** Placements the tidying is not built for, which only the guarantee handles. */
const GUARANTEE_ONLY = new Set([
  ...SEPARATORS.map((_, index) => `split${index}`),
  'fullwidth',
  'mathBold',
  'superscript',
  'circled',
  ...Object.keys(ZEROS),
])

/** Words a real account name might have, with digits of their own. */
const REAL_WORDS = [
  '401K',
  'ROTH 401(K)',
  '529',
  '12 MONTH',
  '6 MO',
  '2025',
  '3RD',
  'TOP 10',
  '24/7',
  '1-2 YEAR',
]

// The oracle: whether a shown name reveals the mask, written on its own from
// the rule, sharing no code with accountNumber.ts.

/** Text with fullwidth, math, superscript and circled digits folded, and other scripts' read by ZEROS. */
function plainDigits(text: string): string {
  const zeros = [0x30, ...Object.values(ZEROS)]
  return [...text.normalize('NFKC')]
    .map((character) => {
      if (!/\p{Nd}/u.test(character)) return character
      const point = character.codePointAt(0)!
      const zero = zeros.find((first) => point >= first && point < first + 10)
      // A digit the oracle can't read would let a leak through unseen: fail loudly instead.
      if (zero === undefined) throw new Error(`The oracle can't read the digit ${character}`)
      return String(point - zero)
    })
    .join('')
}

/** Every ending of a text, two characters or more, the whole text included. */
function endings(text: string): Set<string> {
  const all = new Set<string>()
  for (let start = 0; start <= text.length - 2; start++) all.add(text.slice(start))
  return all
}

function reveals(name: string, mask: string): boolean {
  const key = plainDigits(mask).toUpperCase()
  const text = plainDigits(name).toUpperCase()
  if (/^\d+$/.test(key)) {
    // Runs of digits, split by letters alone.
    const unpadded = key.replace(/^0+/, '')
    return text
      .split(/\p{L}+/u)
      .map((part) => [...part].filter((character) => /\d/.test(character)).join(''))
      .some(
        (run) =>
          run.includes(key) || (unpadded.length >= 2 && run === unpadded) || endings(key).has(run),
      )
  }
  // Letters and digits as one string, checked whole and at each word's end.
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const joined = words.join('')
  if (joined.includes(key)) return true
  return words.some((_, index) => {
    const upTo = words.slice(0, index + 1).join('')
    return [...endings(key)].some((ending) => upTo.endsWith(ending))
  })
}

/** Bank-derived name of a Chase checking account. */
function shown(bankName: string, mask: string): string {
  const parts: AccountNameParts = {
    nickname: null,
    bankName,
    institutionName: 'Chase',
    manual: false,
    mask,
    type: 'depository',
    subtype: 'checking',
  }
  return accountDisplayName(parts)
}

/**
 * Placements the tidying is meant to clear with a real word after them. A
 * bare or split mask with more of the name after it is ambiguous by design
 * ("12 MONTH CD"), so the guarantee may name the account by its kind instead.
 */
const AMBIGUOUS_BEFORE_WORDS = new Set([
  'bare',
  'splitHyphen',
  'splitSpace',
  'zeroPaddedBare',
  'lettersInside',
])

/**
 * Whether the tidying leaves a split mask to the guarantee. A mask of two
 * digits split with nothing leading up to it, "5-2", is never joined, as it is
 * more likely a range like "1-2 YEAR"; nor is a mask with letters, "12-AB".
 * The guarantee then names the account by its kind instead.
 */
function splitLeftToGuarantee(mask: string, placement: string): boolean {
  const unjoined = ['splitHyphen', 'splitSpace', 'lettersInside']
  if (/\D/.test(mask)) return [...unjoined, 'splitAfterX'].includes(placement)
  return mask.length === 2 && unjoined.includes(placement)
}

/**
 * Whether a real word's digits run straight on from the placement's, so the
 * two can spell the mask between them: "...111" then "1-2 YEAR" reads 1111.
 * The tidying rightly takes such digits for the number.
 */
function touches(name: string, word: string, mask: string): boolean {
  const tail = /[\d\s-]*$/.exec(name)![0].replace(/\D/g, '')
  const head = /^[\d\s-]*/.exec(word)![0].replace(/\D/g, '')
  return tail !== '' && head !== '' && !tail.includes(mask) && (tail + head).includes(mask)
}

describe('the oracle', () => {
  it('agrees with the rule on plain cases', () => {
    expect(reveals('Chase Checking 4417', '4417')).toBe(true)
    expect(reveals('Chase Checking 44–17', '4417')).toBe(true)
    expect(reveals('Chase Checking ٤٤١٧', '4417')).toBe(true)
    expect(reveals('Chase Card 2AB', '12AB')).toBe(true)
    expect(reveals('Chase Checking', '4417')).toBe(false)
    expect(reveals('Chase Top 10', '4417')).toBe(false)
  })

  it("fails loudly on a digit it can't read", () => {
    expect(() => reveals('Checking ০', '4417')).toThrow("can't read")
  })
})

describe('the guarantee, across masks, placements and real words', () => {
  const cases = MASKS.flatMap((mask) =>
    Object.entries(placements(mask)).flatMap(([placement, name]) => [
      { mask, placement, word: '', bankName: name, wordFirst: false },
      ...REAL_WORDS.flatMap((word) => [
        { mask, placement, word, bankName: `${word} ${name}`, wordFirst: true },
        { mask, placement, word, bankName: `${name} ${word}`, wordFirst: false },
      ]),
    ]),
  )

  it('covers every pairing', () => {
    const perMask = Object.keys(placements('4417')).length
    expect(perMask).toBe(61)
    expect(cases).toHaveLength(MASKS.length * perMask * (1 + REAL_WORDS.length * 2))
  })

  it('never shows the mask, in any of them', () => {
    const leaks = cases
      .map(({ bankName, mask }) => ({ bankName, mask, name: shown(bankName, mask) }))
      .filter(({ name, mask }) => reveals(name, mask))
    expect(leaks).toEqual([])
  })

  it('keeps a real word whose digits do not collide with the mask', () => {
    const lost = cases
      .filter(({ word, mask }) => word && !reveals(word, mask))
      .filter(({ placement }) => !GUARANTEE_ONLY.has(placement))
      .filter(({ placement, wordFirst }) => wordFirst || !AMBIGUOUS_BEFORE_WORDS.has(placement))
      .filter(({ placement, mask }) => !splitLeftToGuarantee(mask, placement))
      .filter(
        ({ bankName, word, mask, wordFirst }) =>
          wordFirst || !touches(bankName.slice(0, -word.length - 1), word, mask),
      )
      .map(({ bankName, word, mask }) => {
        const name = shown(bankName, mask)
        // Cased as the name is once the number is out: "x52" alone doesn't make it styled.
        const shouted = isShouted(withoutAccountNumber(bankName, mask))
        const readable = readableCase(word, { shouted })
        return name.includes(readable) ? null : { bankName, mask, name }
      })
      .filter(Boolean)
    expect(lost).toEqual([])
  })
})
