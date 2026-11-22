// The pure rules behind who Chat keeps out of what it sends a model: which
// transactions are one person paying another, which shops the owner buys
// from, which names are read from a payment, and where each is hidden.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { isCommonWord } from '../src/domain/chat/commonWords.js'
import { isKnownShop, knownShops, NO_SHOPS, startsAShop } from '../src/domain/chat/knownShops.js'
import { loneNamesOf } from '../src/domain/chat/loneNames.js'
import { namesSomeone } from '../src/domain/chat/movementWords.js'
import { isPersonPayment, lineName, namesIn, namesToHide } from '../src/domain/chat/personNames.js'
import { personPayment, type Movement } from '../src/domain/transfers.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const FROM_APPS = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'

/** A transaction as the rules read it: money out, with only what a case sets. */
const movement = (fields: Partial<Movement>): Movement => ({
  name: '',
  merchantName: null,
  amountCents: 2_000,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

describe('one person paying another', () => {
  const shops = knownShops(['eBay', 'Spotify'])
  const paypal = (fields: Partial<Movement>) =>
    isPersonPayment(movement({ name: 'PAYPAL INST XFER', ...fields }), shops)

  it('through PayPal by bare transfer, is a person unless the merchant is a known shop', () => {
    expect(paypal({ merchantName: 'EBAY', providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(false)
    expect(paypal({ merchantName: 'Spotify', providerCategoryPrimary: 'TRANSFER_OUT' })).toBe(false)
    const person = { merchantName: 'Quillon Marsh', providerCategoryDetailed: ACCOUNT_TRANSFER }
    expect(paypal(person)).toBe(true)
    // With no merchant there is no name to hide, so nothing makes it a person's.
    expect(paypal({ providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(false)
    expect(paypal({ merchantName: 'Quillon Marsh' })).toBe(false)
  })

  it('through PayPal, is a person when the line names one or Plaid files it as from an app', () => {
    expect(paypal({ merchantName: 'eBay', providerCategoryDetailed: FROM_APPS })).toBe(true)
    const named = {
      name: 'PAYPAL TRANSFER TO QUILLON MARSH',
      providerCategoryDetailed: ACCOUNT_TRANSFER,
    }
    expect(paypal(named)).toBe(true)
  })

  it('through Venmo, Cash App or Zelle, takes any transfer code', () => {
    for (const name of ['VENMO PAYMENT', 'CASH APP*PAYMENT', 'ZELLE PAYMENT']) {
      const tx = movement({ name, merchantName: 'eBay' })
      expect(isPersonPayment({ ...tx, providerCategoryDetailed: ACCOUNT_TRANSFER }, shops)).toBe(
        true,
      )
      const service = { ...tx, providerCategoryDetailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' }
      expect(isPersonPayment(service, shops)).toBe(false)
    }
  })

  it('is never a shop paid through an app, or money that went through none', () => {
    const spotify = movement({ name: 'PAYPAL *SPOTIFY', merchantName: 'Spotify' })
    expect(isPersonPayment(spotify, NO_SHOPS)).toBe(false)
    const payroll = movement({
      name: 'ACME CORP PAYROLL',
      amountCents: -250_000,
      providerCategoryDetailed: 'TRANSFER_IN_DEPOSIT',
    })
    expect(isPersonPayment(payroll, NO_SHOPS)).toBe(false)
  })
})

describe("a person's name as the bank wrote it", () => {
  const counterparty = (name: string) => personPayment(movement({ name }))?.counterparty

  it('ends before the memo the sender wrote, quoted or not', () => {
    expect(counterparty('Zelle payment to JANE DOE for rent')).toBe('Jane Doe')
    expect(counterparty('Zelle payment to Jane Doe "dinner"')).toBe('Jane Doe')
    expect(counterparty('Zelle payment to Jane Doe “dinner”')).toBe('Jane Doe')
    expect(counterparty('Zelle payment to JANE DOE; dinner')).toBe('Jane Doe')
    expect(counterparty('Zelle payment to JANE DOE #A1B2C3')).toBe('Jane Doe')
    expect(counterparty('Zelle payment to JANE DOE Conf# T0ABCD')).toBe('Jane Doe')
    // "For" inside a name is left alone.
    expect(counterparty('Zelle payment to JANE FORD')).toBe('Jane Ford')
  })

  it('is what is left of a line with no "to" or "from", without the app, words or codes', () => {
    expect(lineName('Zelle Transfer Conf# T0ABCD123; Jane Doe')).toBe('Jane Doe')
    expect(lineName('CASH APP*TOBIAS FENNWICK')).toBe('TOBIAS FENNWICK')
    expect(lineName("VENMO 1234567 MEMO D'ARCY")).toBe("D'ARCY")
    expect(lineName('PAYPAL INST XFER 99')).toBe('')
    expect(lineName('*** / ***')).toBe('')
  })
})

describe('the names read from a payment between people', () => {
  const shops = knownShops(['eBay'])

  it('are the name after "to" or "from" and the merchant, unless the merchant is a shop', () => {
    const tx = movement({ name: 'Zelle payment to JANE DOE 4417', merchantName: 'JANE Q DOE' })
    expect(namesIn(tx, shops)).toEqual(['Jane Doe', 'Jane Q Doe'])
    const shop = movement({ name: 'PAYPAL INST XFER', merchantName: 'EBAY' })
    expect(namesIn(shop, shops)).toEqual([])
  })

  it("are what is left of the bank's line when it names no one otherwise", () => {
    const tx = movement({ name: 'Zelle Transfer Conf# T0ABCD123; Jane Doe', merchantName: 'Zelle' })
    expect(namesIn(tx, shops)).toEqual(['Jane Doe'])
    expect(namesIn(movement({ name: 'VENMO 1234567' }), shops)).toEqual([])
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

  it('reads a name as someone only when it has a word beyond how money moved', () => {
    expect(namesSomeone('Zelle to Ilsabet Quorn')).toBe(true)
    for (const name of ['Venmo Payment', 'Online transfer', 'Conf Ref', 'X', '']) {
      expect(namesSomeone(name)).toBe(false)
    }
  })
})
