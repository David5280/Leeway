// The pure rules behind who Chat keeps out of what it sends a model: which
// shops the owner buys from, which names are read from a payment between
// people (betweenPeople.test.ts finds them), and where each is hidden.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { isCommonWord } from '../src/domain/chat/commonWords.js'
import { isKnownShop, knownShops, NO_SHOPS, startsAShop } from '../src/domain/knownShops.js'
import { loneNamesOf } from '../src/domain/chat/loneNames.js'
import { namesSomeone } from '../src/domain/movementWords.js'
import { namesIn, namesToHide } from '../src/domain/chat/personNames.js'
import type { Movement, PersonPayment } from '../src/domain/transfers.js'

/** A transaction as the rules read it: money out, with only what a case sets. */
const movement = (fields: Partial<Movement>): Movement => ({
  name: '',
  merchantName: null,
  amountCents: 2_000,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

describe('the names read from a payment between people', () => {
  const context = {
    shops: knownShops(['eBay']),
    accounts: { words: new Set<string>(), masks: new Set<string>() },
  }
  const person = (counterparty: string | null): PersonPayment => ({
    app: 'Zelle',
    direction: 'out',
    counterparty,
  })

  it('are the name after "to" or "from" and the merchant, unless the merchant is a shop', () => {
    const tx = movement({ name: 'Zelle payment to JANE DOE 4417', merchantName: 'JANE Q DOE' })
    expect(namesIn(tx, person('Jane Doe'), context)).toEqual(['Jane Doe', 'Jane Q Doe'])
    const shop = movement({ name: 'PAYPAL INST XFER', merchantName: 'EBAY' })
    expect(namesIn(shop, person(null), context)).toEqual([])
  })

  it("are what is left of the bank's line when it names no one otherwise", () => {
    const tx = movement({ name: 'Zelle Transfer Conf# T0ABCD123; Jane Doe', merchantName: 'Zelle' })
    expect(namesIn(tx, person(null), context)).toEqual(['Jane Doe'])
    expect(namesIn(movement({ name: 'VENMO 1234567' }), person(null), context)).toEqual([])
  })
})

describe('the shops the owner buys from', () => {
  const shops = knownShops(["Wendy's", 'Marigold Bakery', 'Xcel Energy', ' '])

  it('are known by their whole name, in any case', () => {
    expect(isKnownShop(shops, ' xcel energy ')).toBe(true)
    expect(isKnownShop(shops, 'Xcel')).toBe(false)
    expect(isKnownShop(NO_SHOPS, 'Xcel Energy')).toBe(false)
  })

  it('are called by their whole name or first word, never a word inside or with more attached', () => {
    expect(startsAShop(shops, 'marigold')).toBe(true)
    expect(startsAShop(shops, "Wendy's")).toBe(true)
    expect(startsAShop(shops, 'Wendy')).toBe(false)
    expect(startsAShop(shops, 'Bakery')).toBe(false)
  })
})

describe('the words of a name hidden alone', () => {
  it('are every word of it, middle names too, and a name of one word itself', () => {
    expect(
      loneNamesOf(['Jane Q Doe', 'José María Núñez', 'Quillon', 'Jane Roe'], NO_SHOPS),
    ).toEqual(['Jane', 'Doe', 'José', 'María', 'Núñez', 'Quillon', 'Roe'])
    expect(loneNamesOf(['D’Arcy Vane'], NO_SHOPS)).toEqual(['D’Arcy', 'Vane'])
  })

  it('leave out common words, months, banks, contacts, money words and odd parts', () => {
    const names = ['Bill', 'RENT', 'WILL', 'CHASE', 'Mom', 'May Chen', 'Online Fennwick', 'J. Doe']
    expect(loneNamesOf(names, NO_SHOPS)).toEqual(['Chen', 'Fennwick', 'Doe'])
    expect(isCommonWord('JUNE')).toBe(true)
    expect(isCommonWord('Jane')).toBe(false)
  })

  it('leave out how a shop is called, but not a word a shop only contains', () => {
    const shops = knownShops(['Marigold Bakery', "Wendy's"])
    expect(loneNamesOf(['Marigold Pettiwhistle', 'Wendy Bakery'], shops)).toEqual([
      'Pettiwhistle',
      'Wendy',
      'Bakery',
    ])
  })
})

describe('where each name is hidden', () => {
  it('is everywhere for a full name, and only alone in notes for each word of one', () => {
    expect(namesToHide(['Jane Doe', 'Jane Doe', 'Bill', 'Quillon'], NO_SHOPS)).toEqual({
      names: ['Jane Doe'],
      loneNames: ['Jane', 'Doe', 'Quillon'],
    })
  })

  it("leaves out a business's name, which is no person", () => {
    for (const business of ['Acme Plumbing LLC', 'Quorn & Sons Inc.', 'Vale Co']) {
      expect(namesToHide([business, 'Jane Doe'], NO_SHOPS).names).toEqual(['Jane Doe'])
    }
  })

  it('reads a name as someone only when it has a word beyond how money moved', () => {
    expect(namesSomeone('Zelle to Ilsabet Quorn')).toBe(true)
    for (const name of ['Venmo Payment', 'Online transfer', 'Conf Ref', 'X', '']) {
      expect(namesSomeone(name)).toBe(false)
    }
  })
})
