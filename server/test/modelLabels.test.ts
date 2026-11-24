// What a model is shown instead of a transaction's own name: its name only
// when the allowlist vouches for it as a purchase from a business, and
// otherwise a label for its kind, so no way of writing a person's name, and
// no code Plaid files a person under, can reach the model. Every name is made up.

import { describe, expect, it } from 'vitest'
import { neutralLabel, readsAsLabelled, type LabelSubject } from '../src/domain/modelLabels.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const SERVICES = 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'
const GOODS = 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'
const COFFEE = 'FOOD_AND_DRINK_COFFEE'

/** A line as labelling reads it: money out with no code unless a case says otherwise. */
function movement(name: string, fields: Partial<LabelSubject> = {}): LabelSubject {
  return {
    name,
    merchantName: null,
    amountCents: 2_000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    ...fields,
  }
}

/** The label a line gets, with no shops known. */
const labelOf = (name: string, fields: Partial<LabelSubject> = {}) =>
  neutralLabel(movement(name, fields))

const label = (name: string, fields: Partial<LabelSubject> = {}) => labelOf(name, fields)?.label
/** A line with the given detailed code, money out unless an amount is given. */
const coded = (code: string, fields: Partial<LabelSubject> = {}) => ({
  providerCategoryDetailed: code,
  ...fields,
})

describe('the allowlist: a line shows its name only when all of it holds', () => {
  it('shows a purchase, a utility bill, a card payment, a fee, a charity or pay by name', () => {
    const shown: [string, string, string | null][] = [
      ['STARBUCKS #1234', COFFEE, 'Starbucks'],
      ['AMAZON MKTPL*AB12CD', GOODS, 'Amazon'],
      ['NETFLIX.COM', 'ENTERTAINMENT_TV_AND_MOVIES', null],
      ['DELTA AIR 0062', 'TRAVEL_FLIGHTS', null],
      ['SHELL OIL 5741', 'TRANSPORTATION_GAS', null],
      ['HOME DEPOT #4410', 'HOME_IMPROVEMENT_HARDWARE', null],
      ['XCEL ENERGY', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', null],
      ['CHASE CREDIT CRD AUTOPAY', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', null],
      ['OVERDRAFT FEE', 'BANK_FEES_OVERDRAFT_FEES', null],
      ['RED CROSS DONATION', 'GOVERNMENT_AND_NON_PROFIT_DONATIONS', null],
      ['PAYROLL ACME CORP', 'INCOME_WAGES', null],
      ['ACME CORP SALARY', 'INCOME_SALARY', null],
    ]
    for (const [name, code, merchantName] of shown) {
      expect([name, labelOf(name, coded(code, { merchantName }))]).toEqual([name, null])
    }
    // A medical row shows only with Plaid's word for the business.
    const pharmacy = coded('MEDICAL_PHARMACIES_AND_SUPPLEMENTS', { merchantEntityId: 'ent_cvs' })
    expect(labelOf('CVS PHARMACY 01234', pharmacy)).toBeNull()
  })

  it('labels every code it does not list, and a family named without its detail', () => {
    const cases: [string, string, number, string][] = [
      ['ODALYS LARKSPUR', SERVICES, 1, 'Service payment'],
      ['GLOW NAILS', 'PERSONAL_CARE_HAIR_AND_BEAUTY', 1, 'Service payment'],
      ['GLOW NAILS', 'PERSONAL_CARE_HAIR_AND_BEAUTY', -1, 'Service refund'],
      ['AVALON BAY', 'RENT_AND_UTILITIES_RENT', 1, 'Rent payment'],
      ['AVALON BAY', 'RENT_AND_UTILITIES', 1, 'Bill payment'],
      ['AVALON BAY', 'RENT_AND_UTILITIES', -1, 'Bill refund'],
      ['ROSALIND ABERCROMBIE DES:LOAN', 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', 1, 'Loan payment'],
      ['SALLIE MAE BANK', 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', 1, 'Loan payment'],
      ['BEXLEY FENNIMORE', 'INCOME_OTHER_INCOME', -1, 'Deposit'],
      ['BEXLEY FENNIMORE', 'INCOME_DIVIDENDS', 1, 'Payment sent'],
    ]
    for (const [name, code, sign, expected] of cases) {
      const found = labelOf(name, coded(code, { amountCents: sign * 1_000 }))
      expect([name, code, found]).toEqual([name, code, { label: expected, kind: 'unknown' }])
    }
  })

  it('labels a line with no code, imported or not, by its direction', () => {
    expect(labelOf('JANE PRYCEWOOD')).toEqual({ label: 'Purchase or payment', kind: 'unknown' })
    expect(label('JANE PRYCEWOOD', { amountCents: -1 })).toBe('Money received')
    expect(label('MARIGOLD CAFE 0042')).toBe('Purchase or payment')
  })

  it('labels a listed code whose line reads as money moved to or from someone', () => {
    expect(label('BILL PAY XCEL ENERGY', coded('RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'))).toBe(
      'Bill payment',
    )
    expect(label('VENMO TO VENMO CREDIT CARD', coded('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'))).toBe(
      'Card payment',
    )
    expect(
      label('ONLINE BANKING PAYMENT TO CRD 8842', coded('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')),
    ).toBe('Card payment')
  })

  it("labels a person's shape as its merchant, unless Plaid vouched for the business", () => {
    const larkspur = { merchantName: 'Odalys Larkspur', ...coded(GOODS) }
    expect(label('ODALYS LARKSPUR', larkspur)).toBe('Purchase or payment')
    // With no merchant, what the line cleans to is read the same way.
    expect(label('BEXLEY FENNIMORE', coded('INCOME_WAGES', { amountCents: -9 }))).toBe('Deposit')
    expect(label('JANE Q. DOEBRIGHT', coded(GOODS))).toBe('Purchase or payment')
    expect(labelOf('ODALYS LARKSPUR', { ...larkspur, merchantEntityId: 'ent_123' })).toBeNull()
    // Everyday and business words, and a possessive, are no one's name.
    for (const merchantName of ['King Soopers', 'Taco Bell', "Joe's Pizza", 'Blue Bottle Coffee']) {
      expect([merchantName, labelOf('X', { merchantName, ...coded(COFFEE) })]).toEqual([
        merchantName,
        null,
      ])
    }
  })

  it("labels a medical line without Plaid's word for the business, or naming a clinician", () => {
    const medical = (name: string, merchantName: string | null = null, entity = 'ent_1') =>
      label(name, { merchantName, merchantEntityId: entity, ...coded('MEDICAL_OTHER_MEDICAL') })
    expect(medical('DR. ODALYS LARKSPUR LCSW', 'Odalys Larkspur')).toBe('Medical payment')
    expect(medical('MERIDIAN COUNSELING', 'Jane Doe, PsyD')).toBe('Medical payment')
    expect(medical('JANE DOEBRIGHT MD')).toBe('Medical payment')
    expect(medical('BRIGHT SMILES DDS 0042')).toBe('Medical payment')
    expect(medical('CORWIN ASHBY DC')).toBe('Medical payment')
    expect(medical('MARA LINDQVIST NP')).toBe('Medical payment')
    expect(medical('CVS PHARMACY BALTIMORE MD')).toBeUndefined()
    expect(medical('MAYO CLINIC')).toBeUndefined()
    // With no entity id, any medical line is labelled: a clinician goes by their own name.
    for (const name of ['SARAH BETH HOLLOWAY', 'CORWIN ASHBY DC', 'MAYO CLINIC']) {
      expect([name, medical(name, null, '')]).toEqual([name, 'Medical payment'])
    }
  })
})

describe('a line through a payment app', () => {
  it('reads as the app and its direction, wherever the app is named', () => {
    expect(labelOf('Zelle payment to JANE DOE', coded(ACCOUNT_TRANSFER))).toEqual({
      label: 'Zelle payment (sent)',
      kind: 'app',
    })
    expect(label('Venmo from Jane Halloway', { amountCents: -500 })).toBe(
      'Venmo payment (received)',
    )
    expect(label('ZELLE SENT JANE PRYCEWOOD')).toBe('Zelle payment (sent)')
    expect(label('Payment to Wilhelmina Ashcombe via Zelle')).toBe('Zelle payment (sent)')
    expect(label('SENT MONEY TO PELLWORTH ODA')).toBe('Payment app (sent)')
    expect(label('APPLE CASH SENT MONEY', { merchantName: 'Ottoline Grimsby' })).toBe(
      'Apple Cash payment (sent)',
    )
  })

  it('reads as the app whatever code Plaid gave, but a card or loan payment by its code', () => {
    const wages = coded('INCOME_WAGES', { amountCents: -50_000 })
    expect(label('Zelle payment from MARIA SILVA', wages)).toBe('Zelle payment (received)')
    expect(label('CASH APP TO JANE DOE', { providerCategoryPrimary: 'PERSONAL_CARE' })).toBe(
      'Cash App payment (sent)',
    )
    expect(label('VENMO TO VENMO CREDIT CARD', coded('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'))).toBe(
      'Card payment',
    )
    expect(label('PAYPAL *AFFIRM', coded('LOAN_PAYMENTS_OTHER_PAYMENT'))).toBe('Loan payment')
  })

  it("shows a PayPal purchase's merchant: named by Plaid, no app, a shop's code but goods", () => {
    const spotify = { merchantName: 'Spotify', ...coded('ENTERTAINMENT_MUSIC_AND_AUDIO') }
    expect(labelOf('PAYPAL *SPOTIFY', spotify)).toBeNull()
    // No merchant, the app as merchant, general goods, or a code not listed: a label.
    expect(label('PAYPAL *SPOTIFY', coded('ENTERTAINMENT_MUSIC_AND_AUDIO'))).toBe(
      'PayPal payment (sent)',
    )
    expect(label('PAYPAL *SPOTIFY', { ...spotify, merchantName: 'PayPal' })).toBe(
      'PayPal payment (sent)',
    )
    expect(label('PAYPAL *EBAY INC', { merchantName: 'eBay', ...coded(GOODS) })).toBe(
      'PayPal payment (sent)',
    )
    expect(label('PAYPAL *JANEFOXHALL', coded(SERVICES))).toBe('PayPal payment (sent)')
    // A person's shape as merchant, or anyone named after "to", is theirs.
    const person = { merchantName: 'Tamsin Penhallow', ...coded(COFFEE) }
    expect(label('PAYPAL *TAMSINPENHALLOW', person)).toBe('PayPal payment (sent)')
    expect(label('PAYPAL TRANSFER TO SPOTIFY', spotify)).toBe('PayPal payment (sent)')
    // Through any other app, a shop's code shows nothing.
    expect(label('VENMO *SPOTIFY', spotify)).toBe('Venmo payment (sent)')
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
      ['To Jane Doe', SERVICES, 1, 'Service payment'],
      ['From Jane Doe', SERVICES, -1, 'Service refund'],
      ['ONLINE BILL PAYMENT TO JANE DOEBRIGHT', 'RENT_AND_UTILITIES_RENT', 1, 'Rent payment'],
      ['BILL PAY MARGUERITE HAWTHORNE', SERVICES, 1, 'Bill payment'],
      ['BILL PAY REFUND MARGUERITE HAWTHORNE', SERVICES, -1, 'Bill payment returned'],
      ['DEPOSIT FROM BEXLEY FENNIMORE', 'INCOME_OTHER_INCOME', -1, 'Deposit'],
      ['DEPOSIT FROM BEXLEY FENNIMORE', 'INCOME_OTHER_INCOME', 1, 'Deposit returned'],
      ['ACH DEBIT ROSALIND ABERCROMBIE PPD', 'LOAN_PAYMENTS_OTHER_PAYMENT', 1, 'Loan payment'],
      ['ACH PAYMENT YSOLDE CARROW', SERVICES, 1, 'Service payment'],
      ['ONLINE PMT JANE THORNBURY', COFFEE, 1, 'Payment sent'],
    ]
    for (const [name, code, sign, expected] of cases) {
      const found = labelOf(name, coded(code, { amountCents: sign * 1_000 }))
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
      'ACH CREDIT JANE DOE',
      'ONLINE PMT JANE THORNBURY',
    ]) {
      expect([name, label(name)]).toEqual([name, 'Payment sent'])
    }
    expect(label('Bank transfer from Jane Smitherington', { amountCents: -1 })).toBe(
      'Payment received',
    )
    expect(label('BILL PAYMENT JANE DOEBRIGHT')).toBe('Bill payment')
  })
})

describe('a text written as a bill pattern or name', () => {
  it('reads as labelled when it names an app or a transfer to or from someone', () => {
    expect(readsAsLabelled('zelle jane')).toBe(true)
    expect(readsAsLabelled('online transfer to clara')).toBe(true)
    expect(readsAsLabelled('bill pay hawthorne')).toBe(true)
    expect(readsAsLabelled('Rent')).toBe(false)
    expect(readsAsLabelled('chase')).toBe(false)
  })
})
