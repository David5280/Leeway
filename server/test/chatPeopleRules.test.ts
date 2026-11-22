// The pure rules behind who Chat keeps out of what it sends a model: which
// transactions are one person paying another, which shops the owner buys
// from, and which names, whole or alone, are hidden. Every name is made up.

import { describe, expect, it } from 'vitest'
import { isKnownShop, knownShops, NO_SHOPS, startsAShop } from '../src/domain/chat/knownShops.js'
import { loneNamesOf } from '../src/domain/chat/loneNames.js'
import {
  isPersonPayment,
  namesIn,
  namesToHide,
  type PaymentNames,
} from '../src/domain/chat/personNames.js'
import type { Movement } from '../src/domain/transfers.js'

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
    expect(
      paypal({ merchantName: 'Quillon Marsh', providerCategoryDetailed: ACCOUNT_TRANSFER }),
    ).toBe(true)
    // With no merchant there is no name to hide, so nothing makes it a person's.
    expect(paypal({ providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(false)
  })

  it('through PayPal, is a person when the line names one or Plaid files it as from an app', () => {
    expect(paypal({ merchantName: 'eBay', providerCategoryDetailed: FROM_APPS })).toBe(true)
    expect(
      paypal({
        name: 'PAYPAL TRANSFER TO QUILLON MARSH',
        providerCategoryDetailed: ACCOUNT_TRANSFER,
      }),
    ).toBe(true)
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

  it('shows its person after "to", in the merchant name, and in the bank line', () => {
    const tx = movement({ name: 'Zelle payment to JANE DOE 4417', merchantName: 'JANE DOE' })
    expect(namesIn(tx)).toEqual({
      counterparty: ['Jane Doe'],
      merchant: ['Jane Doe'],
      line: [expect.stringMatching(/jane doe/i)],
    })
    // A line that only says money moved names nobody.
    expect(namesIn(movement({ name: 'Online transfer' }))).toEqual({
      counterparty: [],
      merchant: [],
      line: [],
    })
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

describe('the parts of a name hidden alone', () => {
  it('are the given name and surname, capitalized', () => {
    expect(loneNamesOf(['Jane Doe', 'quillon de marsh', 'Jane Roe'], NO_SHOPS)).toEqual([
      'Jane',
      'Doe',
      'Quillon',
      'Marsh',
      'Roe',
    ])
  })

  it('leave out common words, months, banks, money words and odd parts', () => {
    const names = ['Bill Jones', 'Will Turner', 'May Chen', 'Chase Miller', 'Online Fennwick']
    expect(loneNamesOf([...names, 'J. Doe', 'Tobias'], NO_SHOPS)).toEqual([
      'Jones',
      'Turner',
      'Chen',
      'Miller',
      'Fennwick',
      'Doe',
    ])
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

describe('the names Chat hides', () => {
  const found = (fields: Partial<PaymentNames>): PaymentNames => ({
    counterparty: [],
    merchant: [],
    line: [],
    ...fields,
  })

  it('always include a name after "to" or "from", even one a shop goes by', () => {
    const shops = knownShops(['Maria Silva'])
    // "Maria" alone is how that shop is called, so only the surname is hidden alone.
    expect(namesToHide(found({ counterparty: ['Maria Silva'] }), shops)).toEqual({
      names: ['Maria Silva'],
      loneNames: ['Silva'],
    })
  })

  it('drop a merchant name or bank line that is a known shop', () => {
    const shops = knownShops(['eBay'])
    const names = found({
      merchant: ['EBAY', 'Quillon Marsh'],
      line: ['Ebay', 'Zelle To Rosa Vale'],
    })
    expect(namesToHide(names, shops)).toEqual({
      names: ['Quillon Marsh', 'Zelle To Rosa Vale'],
      loneNames: ['Quillon', 'Marsh'],
    })
  })
})
