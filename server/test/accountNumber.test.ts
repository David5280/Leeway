// Account numbers in bank names: the tidying that takes them out, the check
// that guarantees none is shown, and a table crossing masks, placements and
// real words to hold the guarantee across every way a bank writes a number.

import { describe, expect, it } from 'vitest'
import {
  accountDisplayName,
  distinctAccountNames,
  type AccountNameParts,
} from '../src/domain/accountName.js'
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

  it('reads an x between digits as one more digit, where that reads as the number', () => {
    expect(withoutAccountNumber('CHECKING 441x7', '4417')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING 3X9', '39')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING 5x2 PLUS', '52')).toBe('CHECKING PLUS')
    expect(withoutAccountNumber('CHECKING 1x44179', '4417')).toBe('CHECKING')
    // Marked as a number, for any mask: it may be another account's.
    expect(withoutAccountNumber('CHECKING ...41x7', '9921')).toBe('CHECKING')
    // Not between digits, an x is a letter: "2X POINTS" keeps it.
    expect(withoutAccountNumber('2X POINTS CARD', '4417')).toBe('2X POINTS CARD')
  })

  it('keeps digits an x joins that are not the number', () => {
    for (const mask of [null, '4417', '0052']) {
      expect(withoutAccountNumber('CD 12X18 PROMO', mask), String(mask)).toBe('CD 12X18 PROMO')
    }
    expect(withoutAccountNumber('CD 12X18 PROMO', '1218')).toBe('CD PROMO')
    expect(withoutAccountNumber('MARKET 1X1', '1111')).toBe('MARKET 1X1')
    // Each side is still weighed on its own: 18, marked by the x, ends 4418.
    expect(withoutAccountNumber('CD 12X18 PROMO', '4418')).toBe('CD PROMO')
  })

  it("takes out a marked run of two digits or more, which may be another account's mask", () => {
    expect(withoutAccountNumber('OVERDRAFT PROTECTION ...417', '9921')).toBe('OVERDRAFT PROTECTION')
    expect(withoutAccountNumber('SAVINGS LINKED TO #52', '9921')).toBe('SAVINGS LINKED TO')
    expect(withoutAccountNumber('LINKED CARD *88 PLUS', null)).toBe('LINKED CARD PLUS')
    expect(withoutAccountNumber('LINKED CARD (X417)', '9921')).toBe('LINKED CARD')
    expect(withoutAccountNumber('LINKED …0417', '9921')).toBe('LINKED')
  })

  it('keeps a lone marked digit, a decimal and an x inside a word', () => {
    expect(withoutAccountNumber('PLATINUM X2', '9921')).toBe('PLATINUM X2')
    expect(withoutAccountNumber('#1 REWARDS', '9921')).toBe('#1 REWARDS')
    expect(withoutAccountNumber('CD 3.25% APY', '9921')).toBe('CD 3.25% APY')
    expect(withoutAccountNumber('MAX12 CARD', '9921')).toBe('MAX12 CARD')
  })

  it('takes a one-digit mask, once its zeros are off, only where plainly marked or led up to', () => {
    expect(withoutAccountNumber('1ST TIME CHECKING', '01')).toBe('1ST TIME CHECKING')
    expect(withoutAccountNumber('PLATINUM 2-IN-1 CARD', '0001')).toBe('PLATINUM 2-IN-1 CARD')
    expect(withoutAccountNumber('CHECKING X1', '0001')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ENDING IN 1', '01')).toBe('CHECKING')
  })

  it('takes a padded mask written in full however it is placed, even one digit unpadded', () => {
    expect(withoutAccountNumber('CHK0005', '0005')).toBe('CHK')
    expect(withoutAccountNumber('CHECKING (0001)', '0001')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING-0005', '0005')).toBe('CHECKING')
    expect(withoutAccountNumber('CHK00', '00')).toBe('CHK')
    expect(withoutAccountNumber('CHECKING [00] TOP 10', '00')).toBe('CHECKING TOP 10')
    // Written short, it still needs a plain mark: "1ST" is no mask of 0001.
    expect(withoutAccountNumber('CHECKING 1ST', '0001')).toBe('CHECKING 1ST')
  })

  it('takes out a mask with letters, whole or its end', () => {
    expect(withoutAccountNumber('CARD AB12', 'AB12')).toBe('CARD')
    expect(withoutAccountNumber('CARD ending 2AB', '12AB')).toBe('CARD')
    expect(withoutAccountNumber('CARD x2AB PLUS', '12AB')).toBe('CARD PLUS')
    expect(withoutAccountNumber('CARD (ab12)', 'AB12')).toBe('CARD')
    expect(withoutAccountNumber('CARD ...X2', '1X2')).toBe('CARD')
    // Its end, unmarked and with more of the name after it, is left to the guarantee.
    expect(withoutAccountNumber('TAB CARD', '12AB')).toBe('TAB CARD')
  })

  it('takes out a mask with letters only where it plainly starts', () => {
    expect(withoutAccountNumber('CHECKING AB', 'AB')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING #AB', 'AB')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING ...AB', 'AB')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING XXXXAB', 'AB')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING-AB', 'AB')).toBe('CHECKING')
    expect(withoutAccountNumber('CHECKING 00AB', 'AB')).toBe('CHECKING')
    // Starting with a digit, it starts plainly after letters too, like "CHK417".
    expect(withoutAccountNumber('CHK12AB', '12AB')).toBe('CHK')
  })

  it("leaves a mask of letters that runs on from a word's own letters to the guarantee", () => {
    expect(withoutAccountNumber('TOTAL CHECKING', 'NG')).toBe('TOTAL CHECKING')
    expect(withoutAccountNumber('TOTAL CHECKING', 'CK')).toBe('TOTAL CHECKING')
    expect(withoutAccountNumber('CABLE SAVINGS', 'AB')).toBe('CABLE SAVINGS')
    expect(withoutAccountNumber('TEXAS CHECKING', 'AS')).toBe('TEXAS CHECKING')
    expect(withoutAccountNumber('CARDX9Z1', 'X9Z1')).toBe('CARDX9Z1')
    // Nor is a mask of letters taken by its end, which is any word's: "XBC" for ABC.
    expect(withoutAccountNumber('CARD XBC', 'ABC')).toBe('CARD XBC')
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

  it('reads the dingbat digits, which Unicode folds to nothing', () => {
    expect(asciiDigits('❹❹❶❼')).toBe('4417')
    expect(asciiDigits('➃➃➀➆')).toBe('4417')
    expect(asciiDigits('➍➍➊➐')).toBe('4417')
    expect(asciiDigits('❿ ➉ ➓')).toBe('10 10 10')
  })

  it('takes the accents off letters, composed or not', () => {
    expect(asciiDigits('Á1')).toBe('A1')
    expect(asciiDigits('A\u03011')).toBe('A1')
    expect(asciiDigits('Épargne')).toBe('Epargne')
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

  it('reads dingbat digits and accented letters', () => {
    expect(carriesMask('CHECKING ❹❹❶❼', '4417')).toBe(true)
    expect(carriesMask('CHECKING ➀➆', '4417')).toBe(true)
    expect(carriesMask('Card Á1', 'A1')).toBe(true)
    expect(carriesMask('Card A1', 'Á1')).toBe(true)
  })

  it('splits runs at letters, so a letter between digits never hides the end of the mask', () => {
    expect(carriesMask('Checking 44x17', '4417')).toBe(true)
    expect(carriesMask('Top 10 Checking', '4417')).toBe(false)
  })

  it('joins digits across an x where they read as the number', () => {
    expect(carriesMask('Checking 441x7', '4417')).toBe(true)
    expect(carriesMask('Checking 3X9', '39')).toBe(true)
    expect(carriesMask('Checking 4x4x1x7', '4417')).toBe(true)
    expect(carriesMask('Checking 44 1x7', '4417')).toBe(true)
    expect(carriesMask('Checking ...41x7', '4417')).toBe(true)
    expect(carriesMask('CD 12X18 Promo', '1218')).toBe(true)
    expect(carriesMask('Card AB1x2', 'AB12')).toBe(true)
  })

  it('reads an x as a letter where the joined digits are not the number', () => {
    expect(carriesMask('CD 12X18 Promo', '4417')).toBe(false)
    expect(carriesMask('CD 12X18 Promo', '2181')).toBe(false)
    expect(carriesMask('Market 1X1', '1111')).toBe(false)
    expect(carriesMask('Checking 41x7', '4417')).toBe(false)
    // Read as a letter, it still splits off the end of the mask.
    expect(carriesMask('Checking 4x17', '4417')).toBe(true)
    expect(carriesMask('2X Points', '22')).toBe(false)
  })

  it("keeps a mask's own x, so it is found however it is split", () => {
    expect(carriesMask('Checking 1X2', '1X2')).toBe(true)
    expect(carriesMask('Checking 1X 2', '1X2')).toBe(true)
    expect(carriesMask('Checking 1X-2', '1X2')).toBe(true)
    expect(carriesMask('Checking ...X2', '1X2')).toBe(true)
    expect(carriesMask('Checking 12', '1X2')).toBe(false)
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

/**
 * Masks of two to four characters: leading zeros, down to one digit without
 * them, a year, repeated digits, and letters, with digits (an x among them
 * too) or alone.
 */
const MASKS = ['52', '417', '4417', '0352', '0001', '2025', '1111', '12AB', 'X9Z1', '1X2', 'AB']

/** Characters a bank might put between the halves of a mask. */
const SEPARATORS = ['/', '_', ',', ':', '+', '(', ')', '‐', '‑', '‒', '–', '−']

/** The zero of each set of digits the table writes, beyond ASCII. */
const ZEROS = { arabicIndic: 0x660, extendedArabicIndic: 0x6f0, devanagari: 0x966, thai: 0xe50 }

/** Each digit of a mask in another set of digits, letters as they are. */
function inDigits(mask: string, zero: number): string {
  return mask.replace(/\d/g, (digit) => String.fromCodePoint(zero + Number(digit)))
}

/** The three sets of dingbat digits, 1 to 10 each. */
const DINGBATS = ['❶❷❸❹❺❻❼❽❾❿', '➀➁➂➃➄➅➆➇➈➉', '➊➋➌➍➎➏➐➑➒➓']

/** A digit from 1 to 9 as a dingbat, from the set its place picks; anything else as it is. */
function inDingbats(character: string, place: number): string {
  if (!/[1-9]/.test(character)) return character
  return [...DINGBATS[place % DINGBATS.length]!][Number(character) - 1]!
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
    splitBeforeLast: `CHECKING ${mask.slice(0, -1)} ${mask.slice(-1)}`,
    hyphenBeforeLast: `CHECKING ${mask.slice(0, -1)}-${mask.slice(-1)}`,
    xBeforeLast: `CHECKING ${mask.slice(0, -1)}x${mask.slice(-1)}`,
    upperXBeforeLast: `CHECKING ${mask.slice(0, -1)}X${mask.slice(-1)}`,
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
    // Each set of dingbats in turn, and 0, which they lack, as it is.
    dingbat: `CHECKING ${[...mask].map((character, index) => inDingbats(character, index)).join('')}`,
    accented: `CHECKING ${[...mask].map((character) => `${character}\u0301`).join('')}`,
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
  'dingbat',
  'accented',
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

/**
 * Text with fullwidth, math, superscript, circled and dingbat digits folded,
 * other scripts' read by ZEROS, and accents taken off letters.
 */
function plainDigits(text: string): string {
  const zeros = [0x30, ...Object.values(ZEROS)]
  const dingbats = DINGBATS.join('')
  const unaccented = [...text]
    .map((character) => {
      const at = [...dingbats].indexOf(character)
      return at < 0 ? character : String((at % 10) + 1)
    })
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return [...unaccented.normalize('NFKC')]
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
  // An x between digits may stand for one more: "441x7" reads 4417.
  const xJoined = text.replace(/(\d)X(?=\d)/g, '$1')
  if (/^\d+$/.test(key)) {
    // Runs of digits, split by letters alone, with each x a letter.
    const unpadded = key.replace(/^0+/, '')
    const runsOf = (part: string) => part.split(/\p{L}+/u)
    const digitsIn = (run: string) => [...run].filter((character) => /\d/.test(character)).join('')
    const whole = (run: string) => run.includes(key) || (unpadded.length >= 2 && run === unpadded)
    const shows = (run: string) => whole(run) || endings(key).has(run)
    if (runsOf(text).some((run) => shows(digitsIn(run)))) return true
    // Joined at an x, a run counts when it is the whole mask, or marked as a number.
    return runsOf(xJoined).some((run) =>
      /^[*•·.…#-]/.test(run.trim()) ? shows(digitsIn(run)) : whole(digitsIn(run)),
    )
  }
  return lettersReveal(text, key) || lettersReveal(xJoined, key)
}

/** reveals for a mask with letters: letters and digits as one string, whole and at each word's end. */
function lettersReveal(text: string, key: string): boolean {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const joined = words.join('')
  if (joined.includes(key)) return true
  return words.some((_, index) => {
    const upTo = words.slice(0, index + 1).join('')
    return [...endings(key)].some((ending) => upTo.endsWith(ending))
  })
}

/** A linked Chase checking account the bank calls bankName, with no name of the owner's. */
function chaseChecking(bankName: string, mask: string): AccountNameParts {
  return {
    nickname: null,
    bankName,
    institutionName: 'Chase',
    manual: false,
    mask,
    type: 'depository',
    subtype: 'checking',
  }
}

/** Bank-derived name of a Chase checking account. */
function shown(bankName: string, mask: string): string {
  return accountDisplayName(chaseChecking(bankName, mask))
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
  'splitBeforeLast',
  'hyphenBeforeLast',
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
  const unjoined = [
    'splitHyphen',
    'splitSpace',
    'splitBeforeLast',
    'hyphenBeforeLast',
    'lettersInside',
  ]
  // An x put into a mask with an x of its own, "1XX2" for 1X2, ends with the mask's end.
  const intoX = /X/.test(mask) && ['xBeforeLast', 'upperXBeforeLast'].includes(placement)
  if (/\D/.test(mask)) return intoX || [...unjoined, 'splitAfterX'].includes(placement)
  return mask.length === 2 && unjoined.includes(placement)
}

/**
 * Whether the tidying leaves a mask glued to a word's letters to the
 * guarantee: one starting with a letter, "CHECKINGAB", may be the word's own
 * letters, as NG is in CHECKING.
 */
function gluedLeftToGuarantee(mask: string, placement: string): boolean {
  return /^\D/.test(mask) && ['glued', 'gluedShort', 'gluedX'].includes(placement)
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
    expect(reveals('Chase Checking 441x7', '4417')).toBe(true)
    expect(reveals('Chase Checking 3X9', '39')).toBe(true)
    expect(reveals('Chase Checking 1X 2', '1X2')).toBe(true)
    expect(reveals('Chase Market 1X1', '1111')).toBe(false)
    expect(reveals('Chase Checking ❹❹❶❼', '4417')).toBe(true)
    expect(reveals('Chase Card Á1', 'A1')).toBe(true)
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
    expect(perMask).toBe(67)
    expect(cases).toHaveLength(MASKS.length * perMask * (1 + REAL_WORDS.length * 2))
  })

  it('never shows the mask, in any of them', () => {
    const leaks = cases
      .map(({ bankName, mask }) => ({ bankName, mask, name: shown(bankName, mask) }))
      .filter(({ name, mask }) => reveals(name, mask))
    expect(leaks).toEqual([])
  })

  it("never shows another account's mask of digits, in any of them", () => {
    // The bank's name holds the mask of the owner's other account, not its own.
    const own = '9087'
    const leaks = cases
      .filter(({ mask }) => /^\d+$/.test(mask))
      .map(({ bankName, mask }) => {
        const names = distinctAccountNames([
          { ...chaseChecking(bankName, own), id: 'this' },
          { ...chaseChecking('SAVINGS', mask), id: 'other', subtype: 'savings' },
        ])
        return { bankName, mask, name: names.get('this')! }
      })
      .filter(({ name, mask }) => reveals(name, mask) || reveals(name, own))
    expect(leaks).toEqual([])
  })

  it('keeps a real word whose digits do not collide with the mask', () => {
    const lost = cases
      .filter(({ word, mask }) => word && !reveals(word, mask))
      .filter(({ placement }) => !GUARANTEE_ONLY.has(placement))
      .filter(({ placement, wordFirst }) => wordFirst || !AMBIGUOUS_BEFORE_WORDS.has(placement))
      .filter(({ placement, mask }) => !splitLeftToGuarantee(mask, placement))
      .filter(({ placement, mask }) => !gluedLeftToGuarantee(mask, placement))
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
