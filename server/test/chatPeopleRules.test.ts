// The pure rules behind which names Chat hides: which shops the owner buys
// from, which names are read from a labelled row (modelLabels.test.ts labels
// them), and in which forms each is hidden. Every name is made up.

import { describe, expect, it } from 'vitest'
import { isCommonWord } from '../src/domain/chat/commonWords.js'
import { isKnownShop, knownShops, NO_SHOPS, startsAShop } from '../src/domain/knownShops.js'
import { loneNamesOf } from '../src/domain/chat/loneNames.js'
import { namesSomeone } from '../src/domain/movementWords.js'
import { namesIn, namesToHide, type FoundName } from '../src/domain/chat/personNames.js'
import type { Movement } from '../src/domain/transfers.js'

/** A transaction as the rules read it: money out, with only what a case sets. */
const movement = (fields: Partial<Movement>): Movement => ({
  name: '',
  merchantName: null,
  amountCents: 2_000,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

/** Names as found on a payment app's line, named as the person paid when `paid`. */
const found = (...names: string[]): FoundName[] => names.map((name) => ({ name }))

describe('the names read from a labelled row', () => {
  const shops = knownShops(['eBay'])

  it('are the name after "to" or "from" and the merchant, unless the merchant is a shop', () => {
    const tx = movement({ name: 'Zelle payment to JANE DOE 4417', merchantName: 'JANE Q DOE' })
    expect(namesIn(tx, 'app', shops)).toEqual([
      { name: 'Jane Doe', paid: true },
      { name: 'Jane Q Doe' },
    ])
    const shop = movement({ name: 'PAYPAL INST XFER', merchantName: 'EBAY' })
    expect(namesIn(shop, 'app', shops)).toEqual([])
  })

  it("are what is left of an app's line when it names no one otherwise", () => {
    const tx = movement({ name: 'Zelle Transfer Conf# T0ABCD123; Halvorsen, Ingrid' })
    expect(namesIn(tx, 'app', shops)).toEqual([{ name: 'Halvorsen Ingrid' }])
    expect(namesIn(movement({ name: 'VENMO 1234567' }), 'app', shops)).toEqual([])
  })

  it("leave out the owner's own app account, and mark a transfer's", () => {
    expect(
      namesIn(movement({ name: 'Online Payment to Venmo Credit Card' }), 'app', shops),
    ).toEqual([])
    expect(namesIn(movement({ name: 'XFER TO JANE OSTROVSKA' }), 'transfer', shops)).toEqual([
      { name: 'Jane Ostrovska', paid: false, transfer: true },
    ])
  })

  it('are what is left of a line labelled for having no code, unless it is a shop', () => {
    expect(namesIn(movement({ name: 'JANE PRYCEWOOD' }), 'unknown', shops)).toEqual([
      { name: 'JANE PRYCEWOOD' },
    ])
    expect(namesIn(movement({ name: 'BILL PAY DR HALVORSEN/INGRID' }), 'unknown', shops)).toEqual([
      { name: 'HALVORSEN INGRID' },
    ])
    // Look-alike letters and invisible characters read as the name they show.
    expect(
      namesIn(movement({ name: 'ACH DEBIT T\u0430m\u200bsin Penhallow' }), 'unknown', shops),
    ).toEqual([{ name: 'Tamsin Penhallow' }])
    const marigold = knownShops(['Marigold Cafe'])
    expect(namesIn(movement({ name: 'MARIGOLD CAFE 0042' }), 'unknown', marigold)).toEqual([])
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
  it('are every word of it, in any case when long enough, or as a name when short', () => {
    const names = found('Jane Q Doe', 'José María Núñez', 'Quillon', 'JANE Roe', 'D’Arcy Vane')
    expect(loneNamesOf(names, NO_SHOPS)).toEqual({
      capital: ['Q', 'Doe', 'Roe'].filter((word) => word.length > 1),
      anyCase: ['Jane', 'José', 'María', 'Núñez', 'Quillon', 'D’Arcy', 'Vane'],
      inNotes: [],
    })
  })

  it('leave out common words, months, banks, contacts, money words and odd parts', () => {
    const names = found('Bill', 'RENT', 'WILL', 'CHASE', 'Mom', 'May Chen', 'Online Fennwick')
    expect(loneNamesOf([...names, ...found('J. Doe')], NO_SHOPS)).toEqual({
      capital: ['Doe'],
      anyCase: ['Chen', 'Fennwick'],
      inNotes: [],
    })
    expect(isCommonWord('JUNE')).toBe(true)
    expect(isCommonWord('Jane')).toBe(false)
  })

  it('keep a common word an app named as the person paid, for notes only', () => {
    expect(loneNamesOf([{ name: 'CHASE', paid: true }], NO_SHOPS)).toEqual({
      capital: [],
      anyCase: [],
      inNotes: ['CHASE'],
    })
  })

  it('leave out how a shop is called, a word to skip, but not a word a shop only contains', () => {
    const shops = knownShops(['Marigold Bakery', "Wendy's"])
    const names = found('Marigold Pettiwhistle', 'Wendy Bakery', 'Clara Everyday')
    expect(loneNamesOf(names, shops, new Set(['everyday']))).toEqual({
      capital: [],
      // "Bakery" is a business word, so never a name alone.
      anyCase: ['Pettiwhistle', 'Wendy', 'Clara'],
      inNotes: [],
    })
  })
})

describe('where each name is hidden', () => {
  it('is every form of a full name, the other way round too, and each word alone', () => {
    expect(namesToHide(found('Jane Doe', 'Jane Doe', 'Bill', 'Quillon'), NO_SHOPS)).toEqual({
      names: ['Jane Doe', 'Doe Jane'],
      loneNames: ['Doe'],
      loneAnyCase: ['Jane', 'Quillon'],
      noteNames: [],
    })
  })

  it("hides a business's name with and without its ending, which is never a name alone", () => {
    // A practice can trade under a person's own name, and say what they treat.
    expect(namesToHide(found('Jane Doe Pc'), NO_SHOPS)).toEqual({
      names: ['Jane Doe Pc', 'Jane Doe', 'Doe Jane'],
      loneNames: ['Doe'],
      loneAnyCase: ['Jane'],
      noteNames: [],
    })
    expect(namesToHide(found('Vale Co'), NO_SHOPS)).toEqual({
      names: ['Vale Co', 'Co Vale'],
      loneNames: [],
      loneAnyCase: ['Vale'],
      noteNames: [],
    })
  })

  it('hides a name without the account words a bank wrote after it', () => {
    expect(namesToHide(found('Clara Thornbury Everyday Checking'), NO_SHOPS)).toEqual({
      names: ['Clara Thornbury Everyday Checking', 'Clara Thornbury', 'Thornbury Clara'],
      loneNames: [],
      loneAnyCase: ['Clara', 'Thornbury'],
      noteNames: [],
    })
  })

  it("drops a transfer's name made only of the owner's accounts, and those words alone", () => {
    const own = new Set(['chase', 'checking', 'ally'])
    const transfers: FoundName[] = [
      { name: 'Chase Checking', transfer: true },
      { name: 'Ally Pellworth', transfer: true },
    ]
    expect(namesToHide(transfers, NO_SHOPS, own)).toEqual({
      names: ['Ally Pellworth', 'Pellworth Ally'],
      loneNames: [],
      loneAnyCase: ['Pellworth'],
      noteNames: [],
    })
  })

  it('leaves a business the owner buys from its name, with or without its ending', () => {
    const shops = knownShops(['Acme Plumbing', 'Quorn & Sons Inc.'])
    for (const business of ['Acme Plumbing LLC', 'Quorn & Sons Inc.']) {
      expect(namesToHide(found(business, 'Jane Doe'), shops).names).toEqual([
        'Jane Doe',
        'Doe Jane',
      ])
    }
  })

  it('reads a name as someone only when it has a word beyond how money moved', () => {
    expect(namesSomeone('Zelle to Ilsabet Quorn')).toBe(true)
    for (const name of ['Venmo Payment', 'Online transfer', 'Conf Ref', 'X', '']) {
      expect(namesSomeone(name)).toBe(false)
    }
  })
})
