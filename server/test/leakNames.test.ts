// The name a leak alert may show (leaks/leakNames.ts, leaks/personNames.ts):
// a merchant's, unless it is rent, went through a payment app with no
// merchant named, or reads as a person's however the bank dressed it up.

import { describe, expect, it } from 'vitest'
import { leakName, leakNames } from '../src/domain/leaks/leakNames.js'
import type { CodedLine } from '../src/domain/leaks/merchantCharges.js'
import { looksLikePerson, nameWords, plainText } from '../src/domain/leaks/personNames.js'
import type { AccountMasks } from '../src/domain/safeName.js'

/** A posted line with no merchant name and no codes unless given. */
const line = (fields: Partial<CodedLine> = {}): CodedLine => ({
  id: 'tx-1',
  accountId: 'checking',
  date: '2026-11-10',
  name: 'NETFLIX.COM',
  merchantName: null,
  amountCents: 1549,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

/** No account numbers to guard against. */
const NO_MASKS: AccountMasks = []

/** A zero-width space, as a bank's text may hold one between two words. */
const ZERO_WIDTH = '​'

describe('looksLikePerson', () => {
  it('reads a name a bank dressed up as a person', () => {
    for (const name of [
      'Jane Doe',
      "Pat O'Neil",
      'J. Doe',
      'John and Jane Doe',
      'John & Jane Doe',
      'Doe, Jane',
      'Doe,Jane',
      'DOE/JANE',
      'Jane Doe2',
      `Jane${ZERO_WIDTH}Doe`,
      'Maria De Los Santos Garcia',
      'Maria Del Carmen De Los Santos Garcia',
      'Jane Doe for babysitting',
      'PAYMENT FOR JANE DOE',
      'THE DOE FAMILY',
      'JANE OF DOE',
      'Jane Doe on Elm',
      'BILL PAYMENT - JANE DOE',
      'WEB AUTHORIZED PMT JANE DOE',
      'ONLINE PMT JANE DOE',
      'P2P JANE DOE',
    ]) {
      expect(looksLikePerson(name), name).toBe(true)
    }
  })

  it('reads one word, a business word or a mark no name has as no person', () => {
    for (const name of [
      'Netflix',
      'Netflix.com',
      'Streamly',
      'Corner Hardware',
      'Planet Fitness',
      'Acme Insurance Co',
      'The Home Depot',
      'Bank of America',
      'Spotify USA',
      'AMAZON.COM*AB12CD',
      'Sweet Cow Ice Cream Shop Downtown',
    ]) {
      expect(looksLikePerson(name), name).toBe(false)
    }
  })

  it('judges the words left once the payment words, connecting words and marks are gone', () => {
    expect(nameWords('BILL PAYMENT - JANE DOE 11/04')).toEqual(['JANE', 'DOE'])
    expect(nameWords('Online Payment To Comcast')).toEqual(['Comcast'])
    expect(nameWords('Payment for Jane Doe')).toEqual(['Jane', 'Doe'])
    expect(nameWords('The Doe Family')).toEqual(['Doe', 'Family'])
    expect(nameWords('Bank of America')).toEqual(['Bank', 'America'])
  })

  it('reads one name word left once the connecting words are gone as no person', () => {
    expect(looksLikePerson('The Container')).toBe(false)
  })

  it('makes text plain: look-alike letters plain, invisible marks gone', () => {
    expect(plainText(`Ｊａｎｅ${ZERO_WIDTH}Doe`)).toBe('JaneDoe')
  })
})

describe('leakName', () => {
  it('names a merchant the bank named', () => {
    expect(leakName(line({ merchantName: 'Netflix' }), NO_MASKS)).toBe('Netflix')
  })

  it('names a merchant from its text alone, as a hand-entered or imported line has', () => {
    expect(leakName(line({ name: 'Corner Hardware' }), NO_MASKS)).toBe('Corner Hardware')
    expect(leakName(line({ name: 'Streamly' }), NO_MASKS)).toBe('Streamly')
  })

  it('names no one from text alone that reads as a person', () => {
    expect(leakName(line({ name: 'JANE DOE' }), NO_MASKS)).toBeNull()
    expect(leakName(line({ name: `Jane${ZERO_WIDTH}Doe` }), NO_MASKS)).toBeNull()
  })

  it('never shows an invisible mark from the bank’s text', () => {
    const name = `Corner${ZERO_WIDTH} Hardware${ZERO_WIDTH}`
    expect(leakName(line({ name }), NO_MASKS)).toBe('Corner Hardware')
  })

  it('names no one for rent, even with a merchant the bank named', () => {
    const rent = line({
      name: 'PROPERTY MGMT',
      merchantName: 'Oak Street Properties',
      providerCategoryPrimary: 'RENT_AND_UTILITIES',
      providerCategoryDetailed: 'RENT_AND_UTILITIES_RENT',
    })
    expect(leakName(rent, NO_MASKS)).toBeNull()
  })

  it('names no one paid through a payment app unless the bank named the merchant', () => {
    const app = { name: 'PAYPAL *JANEDOE', providerCategoryPrimary: 'GENERAL_MERCHANDISE' }
    expect(leakName(line(app), NO_MASKS)).toBeNull()
    expect(leakName(line({ ...app, merchantName: 'Etsy' }), NO_MASKS)).toBe('Etsy')
  })

  it.each([
    ['VENMO PAYMENT 1234', 'Jane Doe', 'FOOD_AND_DRINK'],
    ['PAYPAL *JANE DOE', 'Jane Doe', 'GENERAL_MERCHANDISE'],
    ['PAYPAL *JANE DOE', 'Jane Doe', 'ENTERTAINMENT'],
    ['CASH APP*JANE DOE', 'Jane Doe', 'GENERAL_MERCHANDISE'],
    ['VENMO', 'JANE DOE', 'GENERAL_MERCHANDISE'],
  ])(
    'never takes the bank at its word for a payment app line: %s as %s (%s)',
    (name, merchantName, primary) => {
      const app = line({ name, merchantName, providerCategoryPrimary: primary })
      expect(leakName(app, NO_MASKS)).toBeNull()
    },
  )

  it('still names a real merchant paid through a payment app', () => {
    const spotify = line({
      name: 'PAYPAL *SPOTIFY',
      merchantName: 'Spotify',
      providerCategoryPrimary: 'ENTERTAINMENT',
    })
    expect(leakName(spotify, NO_MASKS)).toBe('Spotify')
  })

  it('names a known national brand from its text alone, as a CSV line has', () => {
    expect(leakName(line({ name: 'TACO BELL #031' }), NO_MASKS)).toBe('Taco Bell')
    expect(leakName(line({ name: "Trader Joe's" }), NO_MASKS)).toBe("Trader Joe's")
    expect(leakName(line({ name: 'SPOTIFY USA' }), NO_MASKS)).toBe('Spotify USA')
  })

  it('names no one for a person whose name only starts like a brand', () => {
    expect(leakName(line({ name: 'TACO BELL JANE' }), NO_MASKS)).toBeNull()
    expect(leakName(line({ name: 'JANE BELL' }), NO_MASKS)).toBeNull()
  })

  it.each([
    'Jane Doe for babysitting',
    'PAYMENT FOR JANE DOE',
    'THE DOE FAMILY',
    'JANE OF DOE',
    'Maria Del Carmen De Los Santos Garcia',
  ])('names no one from text that reads as a person: %s', (name) => {
    expect(leakName(line({ name }), NO_MASKS)).toBeNull()
  })

  it('still names a brand whose connecting words sit beside a business word', () => {
    expect(leakName(line({ name: 'BANK OF AMERICA' }), NO_MASKS)).toBe('Bank of America')
    expect(leakName(line({ name: 'THE HOME DEPOT #123' }), NO_MASKS)).toBe('The Home Depot')
  })

  it.each([
    ['State Farm', 'GENERAL_SERVICES', 'GENERAL_SERVICES_INSURANCE'],
    ['Taco Bell', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_FAST_FOOD'],
    ['Best Buy', 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ELECTRONICS'],
    ['Google Fi', 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE'],
    ['Sirius XM', 'ENTERTAINMENT', 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    ['Delta Air', 'TRAVEL', 'TRAVEL_FLIGHTS'],
    ['Life Time', 'PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS'],
  ])(
    'takes the bank at its word for %s, coded where people rarely are',
    (merchant, primary, detailed) => {
      const coded = line({
        name: merchant.toUpperCase(),
        merchantName: merchant,
        providerCategoryPrimary: primary,
        providerCategoryDetailed: detailed,
      })
      // The app tidies a name's letters ("Sirius Xm"), so the letters are compared.
      expect(leakName(coded, NO_MASKS)?.toLowerCase()).toBe(merchant.toLowerCase())
    },
  )

  it.each([
    ['PERSONAL_CARE', 'PERSONAL_CARE_HAIR_AND_BEAUTY'],
    ['PERSONAL_CARE', 'PERSONAL_CARE_OTHER_PERSONAL_CARE'],
    ['GENERAL_SERVICES', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'],
    ['GENERAL_SERVICES', 'GENERAL_SERVICES_CHILDCARE'],
    ['MEDICAL', 'MEDICAL_OTHER_MEDICAL'],
    [null, null],
  ])('still asks whether a merchant coded %s (%s) reads as a person', (primary, detailed) => {
    const coded = line({
      name: 'JANE DOE',
      merchantName: 'Jane Doe',
      providerCategoryPrimary: primary,
      providerCategoryDetailed: detailed,
    })
    expect(leakName(coded, NO_MASKS)).toBeNull()
  })

  it('keys every name by its charge', () => {
    const names = leakNames(
      [line({ id: 'a', merchantName: 'Netflix' }), line({ id: 'b', name: 'JANE DOE' })],
      NO_MASKS,
    )
    expect([...names]).toEqual([
      ['a', 'Netflix'],
      ['b', null],
    ])
  })
})
