// The one rule for money between the owner and another person: through a
// payment app or a plain bank transfer, never a shop, a loan or card, the
// owner's own accounts or their own app balance. Every name is made up.

import { describe, expect, it } from 'vitest'
import {
  betweenPeople,
  personInLine,
  personWords,
  type PeopleContext,
} from '../src/domain/betweenPeople.js'
import { knownShops } from '../src/domain/knownShops.js'
import { nameAfterToOrFrom, type Movement } from '../src/domain/transfers.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const FROM_APPS = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'

/** The owner shops at eBay and Spotify, and banks with "Chase Total Checking" ending 4417. */
const context: PeopleContext = {
  shops: knownShops(['eBay', 'Spotify']),
  accounts: {
    words: new Set(['chase', 'total', 'checking', 'vacation', 'fund']),
    masks: new Set(['4417']),
  },
}

/** A transaction as the rule reads it: money out, with only what a case sets. */
const movement = (fields: Partial<Movement>): Movement => ({
  name: '',
  merchantName: null,
  amountCents: 2_000,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

/** Who a line pays, if it pays a person: their name, or '' when it names none. */
function paid(name: string, fields: Partial<Movement> = {}): string | null {
  const person = betweenPeople(movement({ name, ...fields }), context)
  return person ? (person.counterparty ?? '') : null
}

describe('a payment through an app', () => {
  it('through PayPal by bare transfer, is a person unless the merchant is a known shop', () => {
    const transfer = { providerCategoryDetailed: ACCOUNT_TRANSFER }
    expect(paid('PAYPAL INST XFER', { ...transfer, merchantName: 'EBAY' })).toBeNull()
    expect(paid('PAYPAL INST XFER', { ...transfer, merchantName: 'Clara' })).toBe('')
    // With no merchant there is no name to hide, and no transfer code is no transfer.
    expect(paid('PAYPAL INST XFER', transfer)).toBeNull()
    expect(paid('PAYPAL INST XFER', { merchantName: 'Clara' })).toBeNull()
    expect(
      paid('PAYPAL INST XFER', { merchantName: 'eBay', providerCategoryDetailed: FROM_APPS }),
    ).toBe('')
  })

  it('is a person whom the line names, through any app, Zelle written short too', () => {
    expect(paid('Zelle payment to CLARA JPM99A1B2C3')).toBe('Clara')
    expect(paid('ZEL TO MIRABEL QUINT', { providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(
      'Mirabel Quint',
    )
    expect(
      paid('SENT MONEY TO PELLWORTH ODA', { providerCategoryDetailed: ACCOUNT_TRANSFER }),
    ).toBe('Pellworth Oda')
    expect(paid('Venmo cashout from Zoë Ruiz 8812', { amountCents: -2_500 })).toBe('Zoë Ruiz')
    // A bank's name alone can be a person's, and through an app it is never the owner's account.
    expect(paid('Zelle payment to CHASE')).toBe('Chase')
  })

  it('through Venmo, Cash App or Zelle, takes any transfer code when no one is named', () => {
    for (const name of ['VENMO PAYMENT', 'CASH APP*PAYMENT', 'ZELLE PAYMENT']) {
      expect(paid(name, { providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe('')
      expect(paid(name, { providerCategoryDetailed: 'INCOME_OTHER_INCOME' })).toBeNull()
    }
  })

  it('is never a purchase, a loan or a card payment, whatever it names', () => {
    expect(
      paid('PAYPAL *FROM YOU FLOWERS', {
        providerCategoryDetailed: 'GENERAL_MERCHANDISE_FLORISTS',
      }),
    ).toBeNull()
    const loan = { providerCategoryDetailed: 'LOAN_PAYMENTS_OTHER_PAYMENT' }
    expect(paid('Online Payment to PayPal Credit', loan)).toBeNull()
    const card = { providerCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }
    expect(paid('Online Payment to Venmo Credit Card', card)).toBeNull()
    const service = { providerCategoryDetailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' }
    expect(paid('VENMO PAYMENT', { ...service, merchantName: 'Tobias Fennwick' })).toBeNull()
    // Zelle pays no shop at a till, so a purchase code there is no proof.
    expect(paid('Zelle payment to JANE DOE', service)).toBe('Jane Doe')
    expect(paid('PAYPAL *SPOTIFY', { merchantName: 'Spotify' })).toBeNull()
  })

  it("is never only an account, a card or the app, or the owner's own app balance", () => {
    const transfer = { providerCategoryDetailed: ACCOUNT_TRANSFER }
    expect(paid('Online Payment to Venmo Credit Card', transfer)).toBeNull()
    expect(paid('Transfer from Venmo', { ...transfer, amountCents: -4_000 })).toBeNull()
    expect(
      paid('VENMO CASHOUT PPD ID: 5264681992', { ...transfer, amountCents: -4_000 }),
    ).toBeNull()
    expect(paid('VENMO ADD FUNDS', transfer)).toBeNull()
    expect(paid('APPLE CASH BALANCE ADD', transfer)).toBeNull()
    expect(
      paid('PAYPAL INSTANT TRANSFER TO BANK', { ...transfer, merchantName: 'Clara' }),
    ).toBeNull()
  })

  it('never counts a zero amount', () => {
    expect(paid('Zelle payment to JANE DOE', { amountCents: 0 })).toBeNull()
  })
})

describe('a bank transfer with no app', () => {
  const transfer = { providerCategoryDetailed: ACCOUNT_TRANSFER }

  it('is a person when it names one, without the account words after the name', () => {
    expect(
      paid(
        'ONLINE TRANSFER TO THORNBURY C EVERYDAY CHECKING XXXXXX9081 REF #IBEXYZ ON 11/15/26',
        transfer,
      ),
    ).toBe('Thornbury C')
    expect(paid('Online Transfer to Clara Thornbury', transfer)).toBe('Clara Thornbury')
    expect(paid('ONLINE TRANSFER FROM CLARA THORNBURY', { ...transfer, amountCents: -900 })).toBe(
      'Clara Thornbury',
    )
  })

  it("is the owner's own when it names their account by digits, words or account type", () => {
    expect(paid('ONLINE TRANSFER TO THORNBURY C EVERYDAY CHECKING XXXXXX4417', transfer)).toBeNull()
    expect(paid('Online Transfer to Vacation Fund', transfer)).toBeNull()
    expect(paid('ONLINE TRANSFER TO WAY2SAVE SAVINGS XXXXXX1234', transfer)).toBeNull()
    expect(paid('Transfer to Wells Fargo Checking', transfer)).toBeNull()
    expect(paid('Online transfer', transfer)).toBeNull()
  })

  it('is no person without a transfer code', () => {
    expect(paid('Online Transfer to Clara Thornbury')).toBeNull()
    expect(
      paid('Online Transfer to Clara Thornbury', {
        providerCategoryDetailed: 'LOAN_PAYMENTS_OTHER_PAYMENT',
      }),
    ).toBeNull()
  })
})

describe("a person's name as the bank wrote it", () => {
  it('ends before the memo the sender wrote, quoted or not', () => {
    expect(nameAfterToOrFrom('Zelle payment to JANE DOE for rent')).toBe('Jane Doe')
    expect(nameAfterToOrFrom('Zelle payment to Jane Doe "dinner"')).toBe('Jane Doe')
    expect(nameAfterToOrFrom('Zelle payment to Jane Doe “dinner”')).toBe('Jane Doe')
    expect(nameAfterToOrFrom('Zelle payment to JANE DOE; dinner')).toBe('Jane Doe')
    expect(nameAfterToOrFrom('Zelle payment to JANE DOE #A1B2C3')).toBe('Jane Doe')
    expect(nameAfterToOrFrom('Zelle payment to JANE DOE Conf# T0ABCD')).toBe('Jane Doe')
    // "For" inside a name is left alone, and a line with no "to" or "from" names no one.
    expect(nameAfterToOrFrom('Zelle payment to JANE FORD')).toBe('Jane Ford')
    expect(nameAfterToOrFrom('ZELLE PAYMENT 99')).toBeNull()
  })

  it('keeps only the words that could be a person', () => {
    expect(personWords('Thornbury C Everyday Checking', context.accounts)).toBe('Thornbury C')
    expect(personWords('Chase', context.accounts)).toBe('')
    expect(personWords('Chase', null)).toBe('Chase')
    expect(personWords('Chase Checking XXXX', null)).toBe('')
  })

  it('is what is left of a line with no "to" or "from", without the app, words or codes', () => {
    expect(personInLine('Zelle Transfer Conf# T0ABCD123; Jane Doe')).toBe('Jane Doe')
    expect(personInLine('CASH APP*TOBIAS FENNWICK')).toBe('TOBIAS FENNWICK')
    expect(personInLine('VENMO DES:PAYMENT ID:XXXX INDN:D’ARCY VANE CO ID:99 PPD')).toBe(
      'D’ARCY VANE',
    )
    expect(personInLine('PAYPAL INST XFER 99')).toBe('')
    expect(personInLine('*** / ***')).toBe('')
  })
})
