import { describe, expect, it } from 'vitest'
import {
  isTransfer,
  NO_ACCOUNTS,
  paysTrackedCard,
  personPayment,
  personToPersonApp,
  sameOwnAccounts,
  type Movement,
} from '../src/domain/transfers.js'

/** A checking-account transaction with the given description and bank code. */
function movement(name: string, detailed: string | null, fields: Partial<Movement> = {}): Movement {
  return {
    name,
    merchantName: null,
    amountCents: 10000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: detailed,
    accountType: 'depository',
    ...fields,
  }
}

const ONE_CARD = { cardMasks: ['4321'] }

describe('telling a card payment from spending', () => {
  const payment = movement(
    'Payment to Chase card ending in 4321 11/02',
    'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  )

  it('is a transfer when the card it pays is tracked here', () => {
    expect(isTransfer(payment, ONE_CARD)).toBe(true)
  })

  it('is spending when no card is tracked, since the purchases are not counted anywhere', () => {
    expect(isTransfer(payment, NO_ACCOUNTS)).toBe(false)
  })

  it('is spending when the description names a card that is not tracked', () => {
    expect(isTransfer(payment, { cardMasks: ['9999'] })).toBe(false)
  })

  it('trusts any tracked card when the description names none', () => {
    const plain = movement('CAPITAL ONE MOBILE PMT', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')
    expect(isTransfer(plain, { cardMasks: ['9999'] })).toBe(true)
  })

  it('reads the last four digits however the bank writes them', () => {
    for (const name of ['AMEX EPAYMENT x4321', 'CITI CARD *4321', 'DISCOVER PMT ...4321']) {
      expect(paysTrackedCard(movement(name, null), ONE_CARD), name).toBe(true)
      expect(paysTrackedCard(movement(name, null), { cardMasks: ['1111'] }), name).toBe(false)
    }
  })

  it('cannot rule out a tracked card whose digits the bank never sent', () => {
    expect(paysTrackedCard(payment, { cardMasks: [null] })).toBe(true)
  })

  it('is always a transfer on the card itself, where the payment arrives', () => {
    const arriving = movement('Payment Thank You-Mobile', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', {
      amountCents: -40930,
      accountType: 'credit',
    })
    expect(isTransfer(arriving, NO_ACCOUNTS)).toBe(true)
  })
})

describe('telling a loan payment from spending', () => {
  it('counts a car payment out of checking as spending, even with cards tracked', () => {
    const lease = movement('HYUNDAI MOTOR FIN PAYMENT', 'LOAN_PAYMENTS_CAR_PAYMENT')
    expect(isTransfer(lease, ONE_CARD)).toBe(false)
  })

  it('counts mortgage, student, buy now pay later and other loan payments as spending', () => {
    for (const code of [
      'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
      'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
      'LOAN_PAYMENTS_BNPL',
      'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
      'LOAN_PAYMENTS_OTHER_PAYMENT',
    ]) {
      expect(isTransfer(movement('LENDER PAYMENT', code), ONE_CARD), code).toBe(false)
    }
  })

  it('is a transfer on a tracked loan account, whose other side is already counted', () => {
    const arriving = movement('PAYMENT RECEIVED', 'LOAN_PAYMENTS_CAR_PAYMENT', {
      amountCents: -45000,
      accountType: 'loan',
    })
    expect(isTransfer(arriving, NO_ACCOUNTS)).toBe(true)
  })

  it('reads only the broad code when the bank sent no detailed one', () => {
    const broad = movement('LOAN PMT', null, { providerCategoryPrimary: 'LOAN_PAYMENTS' })
    expect(isTransfer(broad, ONE_CARD)).toBe(false)
  })
})

describe('telling a bank transfer from a payment to a person', () => {
  it('treats a transfer between accounts as a transfer', () => {
    const savings = movement('Online Transfer to SAV ...1234', 'TRANSFER_OUT_SAVINGS')
    expect(isTransfer(savings, NO_ACCOUNTS)).toBe(true)
  })

  it('treats a Zelle, Venmo or Cash App payment as money really sent or received', () => {
    for (const name of [
      'Zelle payment to JANE DOE JPM99B1C2D3E',
      'Zelle payment from JANE DOE BACXYZ123',
      'VENMO PAYMENT 1023456789',
      'CASH APP*JOHN SMITH',
    ]) {
      expect(isTransfer(movement(name, 'TRANSFER_OUT_ACCOUNT_TRANSFER'), NO_ACCOUNTS), name).toBe(
        false,
      )
    }
  })

  it("takes Plaid's own payment app codes as a person paying another", () => {
    const tx = movement('SENT MONEY', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS')
    expect(personToPersonApp(tx)).toBe('a payment app')
    expect(isTransfer(tx, NO_ACCOUNTS)).toBe(false)
  })

  it('finds the app in the merchant name too', () => {
    const tx = movement('ACH DEBIT 0192', 'TRANSFER_OUT_ACCOUNT_TRANSFER', {
      merchantName: 'PayPal',
    })
    expect(personToPersonApp(tx)).toBe('PayPal')
  })

  it('does not mistake a merchant that only contains the letters for an app', () => {
    expect(personToPersonApp(movement('ZELLERS DEPT STORE', null))).toBeNull()
  })

  it('counts cash taken out at an ATM as spending, since it leaves the tracked accounts', () => {
    expect(isTransfer(movement('ATM WITHDRAWAL', 'TRANSFER_OUT_WITHDRAWAL'), NO_ACCOUNTS)).toBe(
      false,
    )
  })

  it('takes any other code the owner put in a transfer category as a transfer', () => {
    expect(isTransfer(movement('AUTO LOAN FUNDING', 'LOAN_DISBURSEMENTS_AUTO'), NO_ACCOUNTS)).toBe(
      true,
    )
    expect(isTransfer(movement('MYSTERY', null), NO_ACCOUNTS)).toBe(true)
  })
})

describe('reading a payment between people', () => {
  // Real-looking Chase descriptions. Leeway stores money in as negative.
  const received = movement(
    'Zelle payment from JANE DOE BACmmhq0yzbn',
    'TRANSFER_IN_ACCOUNT_TRANSFER',
    {
      amountCents: -12500,
    },
  )
  const sent = movement('Zelle payment to JANE DOE JPM99b1c2d3e', 'TRANSFER_OUT_ACCOUNT_TRANSFER', {
    amountCents: 4000,
  })

  it('reads money received from a person as money in, with their name', () => {
    expect(personPayment(received)).toEqual({
      app: 'Zelle',
      direction: 'in',
      counterparty: 'Jane Doe',
    })
  })

  it('reads money sent to a person as money out, with their name', () => {
    expect(personPayment(sent)).toEqual({
      app: 'Zelle',
      direction: 'out',
      counterparty: 'Jane Doe',
    })
  })

  it('takes the direction from the amount, never from the wording', () => {
    // A bank that wrote "to" on money that came in still reads as money in.
    expect(personPayment({ ...sent, amountCents: -4000 })?.direction).toBe('in')
    expect(personPayment({ ...received, amountCents: 12500 })?.direction).toBe('out')
  })

  it('drops reference numbers and keeps a name already in mixed case', () => {
    const tx = movement('Zelle Payment To Jane Doe 18233961847', null, { amountCents: 2000 })
    expect(personPayment(tx)?.counterparty).toBe('Jane Doe')
  })

  it('leaves the name out when the description does not give one', () => {
    expect(personPayment(movement('VENMO PAYMENT 1023456789', null))).toEqual({
      app: 'Venmo',
      direction: 'out',
      counterparty: null,
    })
  })

  it('reads nothing for ordinary transactions or a zero amount', () => {
    expect(personPayment(movement('KING SOOPERS', 'FOOD_AND_DRINK_GROCERIES'))).toBeNull()
    expect(personPayment({ ...sent, amountCents: 0 })).toBeNull()
  })
})

describe('comparing tracked accounts', () => {
  it('ignores order but not which cards, or how many', () => {
    expect(sameOwnAccounts({ cardMasks: ['1', '2'] }, { cardMasks: ['2', '1'] })).toBe(true)
    expect(sameOwnAccounts({ cardMasks: ['1'] }, { cardMasks: ['2'] })).toBe(false)
    expect(sameOwnAccounts({ cardMasks: [null] }, NO_ACCOUNTS)).toBe(false)
  })
})
