import { describe, expect, it } from 'vitest'
import type { Category } from '../src/domain/categories.js'
import { chooseCategory, type Categorizable } from '../src/domain/categorize.js'
import type { Rule } from '../src/domain/rules.js'
import { STARTER_RULES } from '../src/domain/starterRules.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'
import { NO_ACCOUNTS, type OwnAccounts } from '../src/domain/transfers.js'
import { PFC_ALL, PFC_CODES } from './fixtures/plaidTaxonomy.js'

// The starter set as saved categories and rules, each identified by its name.
const categories: Category[] = STARTER_CATEGORIES.map((c, position) => ({
  ...c,
  id: c.name,
  position,
  rollover: false,
  rolloverSince: null,
}))
const rules: Rule[] = STARTER_RULES.map(({ category, ...rule }, position) => ({
  ...rule,
  id: `rule-${position}`,
  categoryId: category,
  position,
  reads: 'bank_text',
}))

const CHECKING_CARD = { cardMasks: ['4321'] }

/** Where a checking-account transaction lands with the whole starter set. */
function fileUnder(
  name: string,
  detailed: string | null,
  fields: Partial<Categorizable> = {},
  accounts: OwnAccounts = CHECKING_CARD,
): string | null {
  const primary = PFC_ALL.find(([, code]) => code === detailed)?.[0] ?? null
  const tx: Categorizable = {
    name,
    merchantName: null,
    amountCents: 2500,
    providerCategoryPrimary: primary,
    providerCategoryDetailed: detailed,
    accountType: 'depository',
    ...fields,
  }
  // Starter rules read the bank's text, so the shown name is never looked at.
  return chooseCategory({ ...tx, shownName: '' }, rules, categories, accounts)?.categoryId ?? null
}

describe('the starter set', () => {
  it("claims only codes in Plaid's published taxonomy", () => {
    const unknown = STARTER_CATEGORIES.flatMap((c) => c.providerCategories).filter(
      (code) => !PFC_CODES.has(code),
    )
    expect(unknown).toEqual([])
  })

  it('is specific but tidy: unique names, each under a heading, groups kept together', () => {
    const names = STARTER_CATEGORIES.map((c) => c.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(STARTER_CATEGORIES.length).toBeGreaterThanOrEqual(25)
    expect(STARTER_CATEGORIES.length).toBeLessThanOrEqual(36)
    const groups = STARTER_CATEGORIES.map((c) => c.group)
    expect(groups.every((group) => group !== null)).toBe(true)
    // A group never comes back after another one started, so headings read once.
    const order = groups.filter((group, i) => group !== groups[i - 1])
    expect(new Set(order).size).toBe(order.length)
  })

  it('gives every starter rule a starter category to point at', () => {
    const names = new Set(STARTER_CATEGORIES.map((c) => c.name))
    expect(STARTER_RULES.filter((r) => !names.has(r.category))).toEqual([])
  })

  it('files every Plaid code somewhere, in either direction, with or without a tracked card', () => {
    const codes = PFC_ALL.map(([, detailed]) => detailed).filter((code) => code !== 'OTHER_OTHER')
    const cases = [2500, -2500].flatMap((amountCents) =>
      [CHECKING_CARD, NO_ACCOUNTS].map((accounts) => ({ amountCents, accounts })),
    )
    const unfiled = codes.filter((code) =>
      cases.some(
        ({ amountCents, accounts }) => !fileUnder('SOMETHING', code, { amountCents }, accounts),
      ),
    )
    expect(unfiled).toEqual([])
  })

  it("leaves Plaid's catch-all OTHER code for the owner to sort", () => {
    expect(fileUnder('UNKNOWN', 'OTHER_OTHER')).toBeNull()
  })
})

describe('filing real transactions with the starter set', () => {
  it.each([
    ['LOWRY LIQUORS', 'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', 'Alcohol'],
    ['KING SOOPERS #12', 'FOOD_AND_DRINK_GROCERIES', 'Groceries'],
    ['SNOOZE AN AM EATERY', 'FOOD_AND_DRINK_RESTAURANT', 'Dining out'],
    ['CHICK-FIL-A #0451', 'FOOD_AND_DRINK_FAST_FOOD', 'Fast food'],
    ['STARBUCKS 2201', 'FOOD_AND_DRINK_COFFEE', 'Coffee'],
    ['SHELL OIL 5744', 'TRANSPORTATION_GAS', 'Gas'],
    ['UBER *TRIP', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'Transportation'],
    ['UNITED AIRLINES', 'TRAVEL_FLIGHTS', 'Travel'],
    ['JIFFY LUBE', 'GENERAL_SERVICES_AUTOMOTIVE', 'Car maintenance'],
    ['XCEL ENERGY', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'Utilities'],
    ['COMCAST', 'RENT_AND_UTILITIES_INTERNET_AND_CABLE', 'Utilities'],
    ['HOME DEPOT', 'HOME_IMPROVEMENT_HARDWARE', 'Home improvement'],
    ['NORDSTROM', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', 'Clothing'],
    ['TARGET', 'GENERAL_MERCHANDISE_SUPERSTORES', 'Shopping'],
    ['CHEWY.COM', 'GENERAL_MERCHANDISE_PET_SUPPLIES', 'Pets'],
    ['VCA ANIMAL HOSPITAL', 'MEDICAL_VETERINARY_SERVICES', 'Pets'],
    ['WALGREENS', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS', 'Health'],
    ['GREAT CLIPS', 'PERSONAL_CARE_HAIR_AND_BEAUTY', 'Personal care'],
    ['LIFE TIME FITNESS', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', 'Fitness'],
    ['AMC THEATRES', 'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', 'Entertainment'],
    ['NETFLIX.COM', 'ENTERTAINMENT_TV_AND_MOVIES', 'Streaming and apps'],
    ['GEICO', 'GENERAL_SERVICES_INSURANCE', 'Insurance'],
    ['CU BOULDER TUITION', 'GENERAL_SERVICES_EDUCATION', 'Education'],
    ['USPS', 'GENERAL_SERVICES_POSTAGE_AND_SHIPPING', 'Services'],
    ['IRS USATAXPYMT', 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', 'Taxes and government'],
    ['RED CROSS', 'GOVERNMENT_AND_NON_PROFIT_DONATIONS', 'Gifts and donations'],
    ['OVERDRAFT FEE', 'BANK_FEES_OVERDRAFT_FEES', 'Fees'],
    ['ATM WITHDRAWAL 1234', 'TRANSFER_OUT_WITHDRAWAL', 'Cash and ATM'],
    ['ROCKET MORTGAGE', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', 'Rent and mortgage'],
    ['AFFIRM PAYMENT', 'LOAN_PAYMENTS_BNPL', 'Debt payments'],
    ['NAVIENT', 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', 'Debt payments'],
    ['Online Transfer to SAV ...1234', 'TRANSFER_OUT_SAVINGS', 'Transfers'],
    ['AUTO LOAN FUNDING', 'LOAN_DISBURSEMENTS_AUTO', 'Transfers'],
  ])('files %s (%s) under %s', (name, code, expected) => {
    expect(fileUnder(name, code)).toBe(expected)
  })

  it('files a car lease payment as a car payment that counts, not a transfer', () => {
    expect(fileUnder('HYUNDAI MOTOR FIN PAYMENT', 'LOAN_PAYMENTS_CAR_PAYMENT')).toBe('Car payment')
  })

  it('keeps a car payment arriving at a tracked loan account out of spending', () => {
    const arriving = { amountCents: -45000, accountType: 'loan' }
    expect(fileUnder('PAYMENT RECEIVED', 'LOAN_PAYMENTS_CAR_PAYMENT', arriving)).toBe('Transfers')
  })

  it('files a card payment as a transfer only when the card is tracked', () => {
    const name = 'Payment to Chase card ending in 4321 11/02'
    const code = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
    expect(fileUnder(name, code)).toBe('Transfers')
    expect(fileUnder(name, code, {}, NO_ACCOUNTS)).toBe('Debt payments')
    expect(fileUnder(name, code, {}, { cardMasks: ['9999'] })).toBe('Debt payments')
  })

  it('files the payment as it arrives on the card as a transfer, never as income', () => {
    const arriving = { amountCents: -40930, accountType: 'credit' }
    const code = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
    expect(fileUnder('Payment Thank You-Mobile', code, arriving, NO_ACCOUNTS)).toBe('Transfers')
  })

  it('files a Zelle sent as money sent and a Zelle received as money received', () => {
    const sent = fileUnder('Zelle payment to JANE DOE JPM99b1c2', 'TRANSFER_OUT_ACCOUNT_TRANSFER', {
      amountCents: 4000,
    })
    const received = fileUnder(
      'Zelle payment from JANE DOE BACmmh0',
      'TRANSFER_IN_ACCOUNT_TRANSFER',
      {
        amountCents: -12500,
      },
    )
    expect(sent).toBe('Sent to people')
    expect(received).toBe('Received from people')
  })

  it('files money received by Zelle as received even when the bank code says out', () => {
    const tx = { amountCents: -12500 }
    expect(fileUnder('Zelle payment from JANE DOE', 'TRANSFER_OUT_ACCOUNT_TRANSFER', tx)).toBe(
      'Received from people',
    )
  })

  it('files Zwift as an app subscription whatever code the bank gave it', () => {
    for (const code of ['MEDICAL_OTHER_MEDICAL', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS']) {
      expect(fileUnder('ZWIFT', code, { merchantName: 'Zwift' })).toBe('Streaming and apps')
    }
  })

  it("files Apple's App Store charges by their description", () => {
    const appStore = fileUnder(
      'APPLE.COM/BILL 866-712-7753 CA',
      'GENERAL_MERCHANDISE_ELECTRONICS',
      {
        merchantName: 'Apple',
      },
    )
    expect(appStore).toBe('Streaming and apps')
  })

  it('files pay under income in either Plaid version', () => {
    expect(fileUnder('ACME PAYROLL', 'INCOME_WAGES', { amountCents: -250000 })).toBe('Income')
    expect(fileUnder('ACME PAYROLL', 'INCOME_SALARY', { amountCents: -250000 })).toBe('Income')
  })
})
