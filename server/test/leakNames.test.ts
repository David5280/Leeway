// The name a leak alert may show (leaks/leakNames.ts): a merchant's, and only
// when the bank's data says a merchant made the charge and the name does not
// read as a person's. Anything else is worded with no name.

import { describe, expect, it } from 'vitest'
import { leakName, leakNames, looksLikePerson } from '../src/domain/leaks/leakNames.js'
import type { CodedLine } from '../src/domain/leaks/merchantCharges.js'
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

describe('looksLikePerson', () => {
  it('reads two to four plain words with no business word as a person', () => {
    for (const name of ['Jane Doe', 'Mary Ann Doe', "Pat O'Neil", 'Jean-Luc Picard', 'J. Doe']) {
      expect(looksLikePerson(name), name).toBe(true)
    }
  })

  it('reads one word, a business word, digits or punctuation as no person', () => {
    for (const name of [
      'Netflix',
      'Planet Fitness',
      'Corner Cafe',
      'Acme Insurance Co',
      'The Home Depot',
      '7-Eleven',
      'Amazon.com',
      'AT&T',
      'Sweet Cow Ice Cream Shop Downtown',
    ]) {
      expect(looksLikePerson(name), name).toBe(false)
    }
  })
})

describe('leakName', () => {
  it('names a merchant the bank named', () => {
    expect(leakName(line({ merchantName: 'Netflix' }), NO_MASKS)).toBe('Netflix')
  })

  it('names a purchase the bank coded, though it named no merchant', () => {
    const coded = line({ name: 'CORNER HARDWARE', providerCategoryPrimary: 'HOME_IMPROVEMENT' })
    expect(leakName(coded, NO_MASKS)).toBe('Corner Hardware')
  })

  it('names no one with no merchant and no purchase code', () => {
    expect(leakName(line({ name: 'CORNER HARDWARE' }), NO_MASKS)).toBeNull()
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

  it('names a utility the bank coded under rent and utilities', () => {
    const power = line({
      name: 'CITY POWER',
      providerCategoryPrimary: 'RENT_AND_UTILITIES',
      providerCategoryDetailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
    })
    expect(leakName(power, NO_MASKS)).toBe('City Power')
  })

  it('names no one paid through a payment app unless the bank named the merchant', () => {
    const app = { name: 'PAYPAL *JANEDOE', providerCategoryPrimary: 'GENERAL_MERCHANDISE' }
    expect(leakName(line(app), NO_MASKS)).toBeNull()
    expect(leakName(line({ ...app, merchantName: 'Etsy' }), NO_MASKS)).toBe('Etsy')
  })

  it('names no one when the merchant the bank gave reads as a person', () => {
    const person = line({
      name: 'JANE DOE',
      merchantName: 'Jane Doe',
      providerCategoryPrimary: 'GENERAL_SERVICES',
    })
    expect(leakName(person, NO_MASKS)).toBeNull()
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
