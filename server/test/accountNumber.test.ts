// Account numbers in bank names: the tidying that takes them out, the check
// that guarantees none is shown, and a table crossing masks, placements and
// real words to hold the guarantee across every way a bank writes a number.

import { describe, expect, it } from 'vitest'
import { accountDisplayName, type AccountNameParts } from '../src/domain/accountName.js'
import { carriesMask, withoutAccountNumber } from '../src/domain/accountNumber.js'
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
    expect(['CHK', 'CHECKING', '']).toContain(withoutAccountNumber('CHK417', '417'))
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
  })
})

describe('carriesMask', () => {
  it('finds the mask in a run of digits, or the end of it', () => {
    expect(carriesMask('Checking 4417', '4417')).toBe(true)
    expect(carriesMask('Checking 044170', '4417')).toBe(true)
    expect(carriesMask('Checking 417', '4417')).toBe(true)
    expect(carriesMask('Checking 17', '4417')).toBe(true)
    expect(carriesMask('Checking 52', '0052')).toBe(true)
    expect(carriesMask('Checking 5', '0005')).toBe(true)
  })

  it('reads digits split by spaces, hyphens and mask characters as one run', () => {
    expect(carriesMask('Checking 44 17', '4417')).toBe(true)
    expect(carriesMask('Checking 4-4-1-7', '4417')).toBe(true)
    expect(carriesMask('Checking 44*17', '4417')).toBe(true)
    expect(carriesMask('Checking 5 2', '52')).toBe(true)
  })

  it('passes other digits, a one-digit mask and no mask', () => {
    expect(carriesMask('12 Month CD', '4417')).toBe(false)
    expect(carriesMask('Checking 7', '4417')).toBe(false)
    expect(carriesMask('Checking 41', '4417')).toBe(false)
    expect(carriesMask('Top 10', '7')).toBe(false)
    expect(carriesMask('Checking 4417', null)).toBe(false)
    expect(carriesMask('Checking', '4417')).toBe(false)
  })
})

// The table: every mask crossed with every way a bank writes it and every real
// word before or after, deterministic, with no randomness.

/** Masks of two to four digits, one with a leading zero and one that is also a year. */
const MASKS = ['52', '417', '4417', '0352', '2025']

/** Each way a bank might write the mask into "CHECKING", as a whole name. */
function placements(mask: string): Record<string, string> {
  const [head, tail] = [mask.slice(0, mask.length / 2), mask.slice(mask.length / 2)]
  const end = mask.slice(-Math.max(2, mask.length - 1))
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
  }
}

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

/**
 * Whether a shown name reveals the mask, written out on its own here rather
 * than calling carriesMask: each digit run, joined across spaces, hyphens and
 * mask characters, against the mask, its ends of two digits or more, and the
 * mask without leading zeros.
 */
function reveals(name: string, mask: string): boolean {
  const unpadded = mask.replace(/^0+/, '')
  const ends = new Set<string>()
  for (let start = 0; start <= mask.length - 2; start++) ends.add(mask.slice(start))
  const runs = name.split(/[^\d\s*•·.…#xX-]+/).map((part) => part.replace(/\D/g, ''))
  return runs.some((run) => run.includes(mask) || run === unpadded || ends.has(run))
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
const AMBIGUOUS_BEFORE_WORDS = new Set(['bare', 'splitHyphen', 'splitSpace', 'zeroPaddedBare'])

/**
 * Placements of a mask split in two with nothing leading up to it. A mask of
 * two digits split so, "5-2", is never joined, as it is more likely a range
 * like "1-2 YEAR", so the guarantee names the account by its kind instead.
 */
const SPLIT = new Set(['splitHyphen', 'splitSpace'])

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
    expect(cases).toHaveLength(MASKS.length * 40 * (1 + REAL_WORDS.length * 2))
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
      .filter(({ placement, wordFirst }) => wordFirst || !AMBIGUOUS_BEFORE_WORDS.has(placement))
      .filter(({ placement, mask }) => !(mask.length === 2 && SPLIT.has(placement)))
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
