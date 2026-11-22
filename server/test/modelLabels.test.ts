// What a model is shown instead of a transaction's own name: its name only
// when it is surely a merchant, and otherwise a label for its kind, so no
// way of writing a person's name can reach the model. Every name is made up.

import { describe, expect, it } from 'vitest'
import { knownShops } from '../src/domain/knownShops.js'
import { neutralLabel, readsAsLabelled, type LabelSubject } from '../src/domain/modelLabels.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'

/** The owner buys at eBay, Spotify and Marigold Cafe. */
const shops = knownShops(['eBay', 'Spotify', 'Marigold Cafe'])

/** The label a line gets: money out with no code unless a case says otherwise. */
function labelOf(name: string, fields: Partial<LabelSubject> = {}) {
  const tx: LabelSubject = {
    name,
    merchantName: null,
    amountCents: 2_000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    ...fields,
  }
  return neutralLabel(tx, shops)
}

const label = (name: string, fields: Partial<LabelSubject> = {}) => labelOf(name, fields)?.label

describe('a line through a payment app', () => {
  it('reads as the app and its direction, wherever the app is named', () => {
    expect(
      labelOf('Zelle payment to JANE DOE', { providerCategoryDetailed: ACCOUNT_TRANSFER }),
    ).toEqual({ label: 'Zelle payment (sent)', kind: 'app' })
    expect(label('Venmo from Jane Halloway', { amountCents: -500 })).toBe(
      'Venmo payment (received)',
    )
    expect(label('ZELLE SENT JANE PRYCEWOOD')).toBe('Zelle payment (sent)')
    expect(label('Payment to Wilhelmina Ashcombe via Zelle')).toBe('Zelle payment (sent)')
    expect(label('Transfer to Jane Lindqvist via Zelle')).toBe('Zelle payment (sent)')
    expect(label('Zelle payment to Jane Corrigan Cash App')).toBe('Zelle payment (sent)')
    expect(label('SENT MONEY TO PELLWORTH ODA')).toBe('Payment app (sent)')
  })

  it('reads as the app even when Plaid filed it as income, a loan or a shop', () => {
    const income = { providerCategoryDetailed: 'INCOME_WAGES', amountCents: -50_000 }
    expect(label('Zelle payment from MARIA SILVA', income)).toBe('Zelle payment (received)')
    expect(label('CASH APP TO JANE DOE', { providerCategoryPrimary: 'PERSONAL_CARE' })).toBe(
      'Cash App payment (sent)',
    )
  })

  it('shows its name only when it paid a shop the owner buys from, naming nobody', () => {
    expect(labelOf('PAYPAL *SPOTIFY')).toBeNull()
    expect(labelOf('PAYPAL INST XFER', { merchantName: 'eBay' })).toBeNull()
    expect(label('PAYPAL *JANEFOXHALL')).toBe('PayPal payment (sent)')
    expect(label('PAYPAL INST XFER', { merchantName: 'Clara' })).toBe('PayPal payment (sent)')
    // A line naming someone after "to" is theirs, whatever else it matches.
    expect(label('PAYPAL TRANSFER TO SPOTIFY')).toBe('PayPal payment (sent)')
  })
})

describe('a transfer or payment to or from someone, with no app', () => {
  it('reads as its kind by its code and direction', () => {
    const cases: [string, string, number, string][] = [
      ['ONLINE TRANSFER TO ALLY BANK', 'TRANSFER_OUT_SAVINGS', 1, 'Transfer to savings'],
      ['ONLINE TRANSFER FROM ALLY BANK', 'TRANSFER_IN_SAVINGS', -1, 'Transfer from savings'],
      [
        'TO WEALTHFRONT',
        'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
        1,
        'Transfer to investments',
      ],
      [
        'FROM WEALTHFRONT',
        'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
        -1,
        'Transfer from investments',
      ],
      ['ATM WITHDRAWAL', 'TRANSFER_OUT_WITHDRAWAL', 1, 'Cash withdrawal'],
      ['ATM REVERSAL', 'TRANSFER_OUT_WITHDRAWAL', -1, 'Cash withdrawal returned'],
      ['MOBILE DEPOSIT', 'TRANSFER_IN_DEPOSIT', -1, 'Deposit'],
      ['DEPOSIT REVERSAL', 'TRANSFER_IN_DEPOSIT', 1, 'Deposit returned'],
      ['Online Transfer to Clara Thornbury', ACCOUNT_TRANSFER, 1, 'Transfer to another account'],
      [
        'Online Transfer from Clara Thornbury',
        'TRANSFER_IN_ACCOUNT_TRANSFER',
        -1,
        'Transfer from another account',
      ],
      [
        'Payment to Chase card ending in 4321',
        'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
        1,
        'Card payment',
      ],
      [
        'Payment to Chase card ending in 4321',
        'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
        -1,
        'Card payment received',
      ],
      ['Online Payment to Ally Auto', 'LOAN_PAYMENTS_CAR_PAYMENT', 1, 'Loan payment'],
      ['Online Payment from Ally Auto', 'LOAN_PAYMENTS_CAR_PAYMENT', -1, 'Loan payment received'],
      [
        'Online Payment 18334 To Bertram Quillfeather',
        'RENT_AND_UTILITIES_RENT',
        1,
        'Rent payment',
      ],
      [
        'Online Payment 18334 From Bertram Quillfeather',
        'RENT_AND_UTILITIES_RENT',
        -1,
        'Rent refund',
      ],
      ['To Jane Doe', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', 1, 'Payment sent'],
      ['From Jane Doe', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', -1, 'Payment received'],
    ]
    for (const [name, code, sign, expected] of cases) {
      const found = labelOf(name, { providerCategoryDetailed: code, amountCents: sign * 1_000 })
      expect([name, found]).toEqual([name, { label: expected, kind: 'transfer' }])
    }
  })

  it('is found however a bank abbreviates it, with or without a code', () => {
    for (const name of [
      'XFER TO JANE OSTROVSKA',
      'TRNSFR FROM JANE PENWARDEN',
      'MOBILE TRANSFER TO JANE ARKWRIGHT',
      'INTERNET TRANSFER TO JANE VELLACOTT',
      'Online Banking transfer to CHK 1234',
      'to Jane Smitherington',
    ]) {
      expect([name, label(name)]).toEqual([name, 'Payment sent'])
    }
    expect(label('Bank transfer from Jane Smitherington', { amountCents: -1 })).toBe(
      'Payment received',
    )
  })
})

describe('any other line', () => {
  it('shows its name with a code that is no transfer, or when the owner typed it in', () => {
    const coffee = { merchantName: 'Starbucks', providerCategoryDetailed: 'FOOD_AND_DRINK_COFFEE' }
    expect(labelOf('STARBUCKS #1234', coffee)).toBeNull()
    expect(labelOf('Farmers market', { handEntered: true })).toBeNull()
  })

  it('shows its name with no code only when it is a shop the owner buys from', () => {
    expect(labelOf('MARIGOLD CAFE 0042')).toBeNull()
    expect(labelOf('SQ *MARIGOLD', { merchantName: 'Marigold Cafe' })).toBeNull()
    expect(labelOf('JANE PRYCEWOOD')).toEqual({ label: 'Purchase or payment', kind: 'unknown' })
    expect(label('JANE PRYCEWOOD', { amountCents: -1 })).toBe('Money received')
  })
})

describe('a text written as a bill pattern or name', () => {
  it('reads as labelled when it names an app or a transfer to or from someone', () => {
    expect(readsAsLabelled('zelle jane')).toBe(true)
    expect(readsAsLabelled('online transfer to clara')).toBe(true)
    expect(readsAsLabelled('Rent')).toBe(false)
    expect(readsAsLabelled('chase')).toBe(false)
  })
})
