// Which posted lines a merchant charged (leaks/merchantCharges.ts): the only
// ones a leak is looked for among. Cash, checks, payments to people, transfers
// and bank fees are the owner's own or the bank's, so two alike are ordinary.

import { describe, expect, it } from 'vitest'
import { findDuplicates } from '../src/domain/leaks/duplicates.js'
import { isMerchantCharge, type CodedLine } from '../src/domain/leaks/merchantCharges.js'

let next = 0

/** A posted line on the checking account, with no bank codes unless given. */
const line = (fields: Partial<CodedLine> = {}): CodedLine => {
  next += 1
  return {
    id: `tx-${next}`,
    accountId: 'checking',
    date: '2026-11-10',
    name: 'CORNER HARDWARE',
    merchantName: null,
    amountCents: 4000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    ...fields,
  }
}

/** Two lines alike on one day, as the leak check would read them once kept. */
const twoAlike = (fields: Partial<CodedLine>) =>
  findDuplicates([line(fields), line(fields)].filter(isMerchantCharge), '2026-11-17')

describe('isMerchantCharge', () => {
  it('keeps a purchase, by its words or its codes', () => {
    expect(isMerchantCharge(line())).toBe(true)
    expect(
      isMerchantCharge(
        line({
          providerCategoryPrimary: 'GENERAL_MERCHANDISE',
          providerCategoryDetailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
        }),
      ),
    ).toBe(true)
  })

  it('leaves out cash taken out, by its code or a bank’s words', () => {
    expect(isMerchantCharge(line({ providerCategoryDetailed: 'TRANSFER_OUT_WITHDRAWAL' }))).toBe(
      false,
    )
    expect(isMerchantCharge(line({ name: 'ATM WITHDRAWAL 1200 MAIN ST' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'CASH WITHDRAWAL BRANCH 12' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'WITHDRAWAL AT ATM #0042' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'ATM W/D 5TH AVE' }))).toBe(false)
  })

  it('reads a bank’s words only as a whole phrase, so a merchant named alike stays one', () => {
    for (const name of [
      'THE ATM BAR AND GRILL',
      'OVERDRAFT BREWING CO',
      'NSF HOLDINGS LLC',
      'RETURNED ITEM BOUTIQUE',
      'CASH AND CARRY WITHDRAWAL',
    ]) {
      expect(isMerchantCharge(line({ name })), name).toBe(true)
    }
  })

  it('leaves out payments to people through an app, by name or code', () => {
    expect(isMerchantCharge(line({ name: 'Zelle payment to Pat Example JPM99A1' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'VENMO PAYMENT 1023', merchantName: 'Venmo' }))).toBe(
      false,
    )
    expect(
      isMerchantCharge(line({ providerCategoryDetailed: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS' })),
    ).toBe(false)
  })

  it('leaves out checks by their number, however the bank writes one', () => {
    for (const name of ['CHECK 1043', 'CHECK #1044', 'CHK 1045', 'Check Paid 1046', 'CHEQUE 77']) {
      expect(isMerchantCharge(line({ name })), name).toBe(false)
    }
    // A merchant whose name starts with the letters is still a merchant.
    expect(isMerchantCharge(line({ name: 'CHECKERS DRIVE IN 4412' }))).toBe(true)
    expect(isMerchantCharge(line({ name: 'CHECK INTO CASH' }))).toBe(true)
  })

  it('leaves out every bank fee, not only overdraft fees', () => {
    expect(isMerchantCharge(line({ providerCategoryDetailed: 'BANK_FEES_ATM_FEES' }))).toBe(false)
    expect(
      isMerchantCharge(line({ providerCategoryDetailed: 'BANK_FEES_FOREIGN_TRANSACTION_FEES' })),
    ).toBe(false)
    expect(isMerchantCharge(line({ providerCategoryPrimary: 'BANK_FEES' }))).toBe(false)
    // With no codes, by the fee's whole name.
    for (const name of [
      'ATM FEE',
      'NON-NETWORK ATM FEE',
      'ATM SURCHARGE',
      'OVERDRAFT FEE',
      'OVERDRAFT ITEM FEE',
      'OVERDRAFT PROTECTION TRANSFER FEE',
      'NSF FEE',
      'INSUFFICIENT FUNDS CHARGE',
      'MONTHLY MAINTENANCE FEE',
      'SERVICE CHARGE',
      'FOREIGN TRANSACTION FEE',
      'WIRE TRANSFER FEE',
    ]) {
      expect(isMerchantCharge(line({ name })), name).toBe(false)
    }
  })

  it('leaves out money moved to an account, by its code or a bank’s words', () => {
    for (const code of [
      'TRANSFER_OUT_ACCOUNT_TRANSFER',
      'TRANSFER_OUT_SAVINGS',
      'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    ]) {
      expect(isMerchantCharge(line({ providerCategoryDetailed: code })), code).toBe(false)
    }
    expect(isMerchantCharge(line({ providerCategoryPrimary: 'TRANSFER_OUT' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'ONLINE TRANSFER TO SAV XXXXXX1234' }))).toBe(false)
    expect(isMerchantCharge(line({ name: 'XFER TO CHECKING' }))).toBe(false)
  })

  it('keeps a merchant whose name only holds the word transfer', () => {
    expect(isMerchantCharge(line({ name: 'TRANSFERWISE INC' }))).toBe(true)
    expect(isMerchantCharge(line({ name: 'BALANCE TRANSFER PILATES' }))).toBe(true)
  })

  it('keeps a purchase through a payment app the bank coded as one', () => {
    /** A payment app line with the bank's primary code, and its detailed one when given. */
    const coded = (name: string, primary: string | null, detailed: string | null = null) =>
      line({ name, providerCategoryPrimary: primary, providerCategoryDetailed: detailed })
    expect(isMerchantCharge(coded('PAYPAL *CORNERSHOP', 'GENERAL_MERCHANDISE'))).toBe(true)
    expect(isMerchantCharge(coded('CASH APP*TACO STAND', 'FOOD_AND_DRINK'))).toBe(true)
    // The detailed code alone says so too.
    expect(
      isMerchantCharge(coded('VENMO *DOG WALKS', null, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES')),
    ).toBe(true)
    // A transfer code, or none, is still a payment to a person.
    expect(
      isMerchantCharge(
        coded('VENMO PAYMENT', 'TRANSFER_OUT', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'),
      ),
    ).toBe(false)
    expect(isMerchantCharge(coded('PAYPAL TRANSFER', null))).toBe(false)
    // Zelle has no checkout, so a code never makes it a store.
    expect(isMerchantCharge(coded('Zelle payment to Pat Example', 'GENERAL_SERVICES'))).toBe(false)
  })
})

describe('no "Charged twice?" for lines the owner made', () => {
  it('stays quiet for two Venmo or Zelle payments of one amount to two people', () => {
    expect(twoAlike({ name: 'VENMO PAYMENT', merchantName: 'Venmo' })).toEqual([])
    expect(twoAlike({ name: 'Zelle payment to Pat Example' })).toEqual([])
  })

  it('stays quiet for two ATM withdrawals, two checks and two ATM fees', () => {
    expect(twoAlike({ name: 'ATM WITHDRAWAL', amountCents: 10000 })).toEqual([])
    const checks = [line({ name: 'CHECK 1043' }), line({ name: 'CHECK 1044' })]
    expect(findDuplicates(checks.filter(isMerchantCharge), '2026-11-17')).toEqual([])
    expect(twoAlike({ name: 'ATM FEE', providerCategoryDetailed: 'BANK_FEES_ATM_FEES' })).toEqual(
      [],
    )
  })

  it('still finds a store that charged twice', () => {
    expect(twoAlike({})).toHaveLength(1)
  })
})
