// The tax export's reading of single transactions: which categories may be
// deductible, which income line a deposit counts on, who paid it and whether
// a credit only pays down a card or loan. Pure, so no database.

import { describe, expect, it } from 'vitest'
import { incomeLine, mayBeDeductible, paysDownDebt } from '../src/domain/tax/classify.js'
import { payerKey } from '../src/domain/tax/income.js'
import type { Transaction } from '../src/domain/transactions.js'
import { madeUpTransaction } from './fixtures/transaction.js'

describe('which categories may be deductible', () => {
  it('flags clear names for medical care, giving, education, childcare and business', () => {
    for (const name of [
      'Health',
      'Medical',
      'Medicine',
      'Prescriptions',
      'Pharmacy',
      'Dentist',
      'Eye care',
      'Charity',
      'Gifts and donations',
      'Tuition',
      'Child care',
      'Daycare',
      'Business',
      'Home office',
      'Work expenses',
    ]) {
      expect(mayBeDeductible(name), name).toBe(true)
    }
  })

  it('leaves broad and everyday names unflagged', () => {
    for (const name of [
      'Health & fitness',
      'Health and wellness',
      'Gym',
      'Personal care',
      'Work',
      'Office snacks',
      'School supplies',
      'Groceries',
      'Pet medicine',
    ]) {
      expect(mayBeDeductible(name), name).toBe(false)
    }
  })
})

describe('the income line of money filed as income', () => {
  /** The line of a made-up deposit. */
  const lineOf = (fields: Partial<Transaction>) =>
    incomeLine(madeUpTransaction({ amountCents: -1000, ...fields }))

  it('reads each kind of money in that is not wages by its bank code', () => {
    expect(lineOf({ bankCategory: 'INCOME_INTEREST_EARNED' })).toBe('interest')
    expect(lineOf({ bankCategory: 'INCOME_DIVIDENDS' })).toBe('dividends')
    expect(lineOf({ bankCategory: 'INCOME_UNEMPLOYMENT' })).toBe('unemployment')
    expect(lineOf({ bankCategory: 'INCOME_RETIREMENT_PENSION' })).toBe('retirement')
    expect(lineOf({ name: 'IRS TREAS 310 TAX REF', bankCategory: 'INCOME_TAX_REFUND' })).toBe(
      'tax_refund',
    )
  })

  it('reads the words of a line whose code is missing or says only that money came in', () => {
    expect(lineOf({ name: 'IRS TREAS 310 TAX REF' })).toBe('tax_refund')
    expect(lineOf({ name: 'STATE TAX REFUND', bankCategory: 'INCOME' })).toBe('tax_refund')
    expect(lineOf({ name: 'DES UNEMPLOYMENT INS' })).toBe('unemployment')
    expect(lineOf({ name: 'ACME PENSION PLAN', bankCategory: 'INCOME_OTHER_INCOME' })).toBe(
      'retirement',
    )
    expect(lineOf({ name: 'CASH BACK REDEMPTION' })).toBe('rewards')
    expect(lineOf({ name: 'CARD REWARDS', merchantName: 'Bank' })).toBe('rewards')
  })

  it('reads the words agencies use for state refunds, benefits and Social Security', () => {
    for (const name of [
      'STATE OF COLORADO TAXRFD',
      'CASTTAXRFD FRANCHISE TAX BD',
      'MN DEPT OF REVENUE MNTAXRFD',
      'DEPT REVENUE STATE TAX RFND',
      'NYS DTF PIT REFUND',
      'CO DEPT OF REV REFUND',
    ]) {
      expect(lineOf({ name }), name).toBe('tax_refund')
    }
    expect(lineOf({ name: 'EDD UI BENEFIT' })).toBe('unemployment')
    expect(lineOf({ name: 'CDLE UI BENEFITS' })).toBe('unemployment')
    expect(lineOf({ name: 'STATEMENT CREDIT REDEMPTION' })).toBe('rewards')
    expect(lineOf({ name: 'SOC SEC 310 SSA TREAS' })).toBe('social_security')
    expect(lineOf({ name: 'SSA TREAS SALARY', bankCategory: 'INCOME_OTHER_INCOME' })).toBe(
      'social_security',
    )
  })

  it('reads a state income tax refund only where the words say so', () => {
    expect(lineOf({ name: 'SMOKE PIT REFUND' })).toBe('pay')
    expect(lineOf({ name: 'STATE PIT REFUND' })).toBe('tax_refund')
  })

  it('reads a direct deposit by who sent it, since the words only say how it came', () => {
    const lines: [string, string][] = [
      ['DIR DEP IRS TREAS 310 TAX REF', 'tax_refund'],
      ['DIRECT DEPOSIT IRS TREAS 310', 'tax_refund'],
      ['Direct deposit from IRS TREAS 310 TAX REF', 'tax_refund'],
      ['DIRECT DEP SSA TREAS 310 XXSOC SEC', 'social_security'],
      ['DIR DEP EDD UI BENEFIT', 'unemployment'],
      ['DIRECT DEP STATE OF CO TAXRFD', 'tax_refund'],
      ['PENSION DIR DEP', 'retirement'],
      ['PENSION FUND ADMIN DIR DEP', 'retirement'],
      ['DIR DEP', 'pay'],
      ['ACME DIRECT DEPOSIT', 'pay'],
    ]
    for (const [name, line] of lines) {
      expect(lineOf({ name }), name).toBe(line)
    }
  })

  it('reads employer words before loose ones, so a paycheck from a payer so named is pay', () => {
    for (const fields of [
      { name: 'REWARDS NETWORK INC PAYROLL' },
      { name: 'CASH BACK CAR WASH LLC PAYROLL' },
      { name: 'Direct Deposit', merchantName: 'Cash Back Car Wash' },
      { name: 'Payroll TAX REFUND ADJ ACME', bankCategory: 'INCOME' },
    ]) {
      expect(lineOf(fields), fields.name).toBe('pay')
    }
  })

  it('trusts a wages code over words, so a payer named for rewards is still pay', () => {
    expect(lineOf({ name: 'REWARDS NETWORK PAYROLL', bankCategory: 'INCOME_WAGES' })).toBe('pay')
  })

  it('keeps a payment from a person and money moved in out of pay, whatever the category is called', () => {
    const person = { app: 'Venmo', direction: 'in' as const, counterparty: 'Sam' }
    expect(lineOf({ bankCategory: 'INCOME_WAGES', person })).toBe('person')
    expect(lineOf({ bankCategory: 'TRANSFER_IN_DEPOSIT' })).toBe('moved_in')
  })

  it('reads anything else as pay', () => {
    expect(lineOf({ name: 'ACME PAYROLL', bankCategory: 'INCOME_WAGES' })).toBe('pay')
    expect(lineOf({ name: 'SIDE GIG LLC', bankCategory: null })).toBe('pay')
  })
})

describe('the payer key', () => {
  /** The key of a made-up deposit with this bank text. */
  const keyOf = (name: string, merchantName: string | null = null) =>
    payerKey(madeUpTransaction({ name, merchantName }))

  it('drops ACH codes and ids, so each deposit from one payer has one key', () => {
    expect(keyOf('ACME PAYROLL PPD ID 123')).toBe('acme payroll')
    expect(keyOf('ACME PAYROLL PPD ID')).toBe('acme payroll')
    expect(keyOf('ACME PAYROLL CCD ID: 9876543210')).toBe('acme payroll')
    expect(keyOf('ACME CORP DES:PAYROLL ID:AB12CD INDN:DOE,JANE CO ID:XXXXX12345 PPD')).toBe(
      'acme corp payroll',
    )
  })

  it('keeps "CO" and "ID" that are part of the name', () => {
    expect(keyOf('STATE OF CO PAYROLL')).toBe('state of co payroll')
    expect(keyOf('STATE OF ID PAYROLL')).toBe('state of id payroll')
    expect(keyOf('CO-OP FOODS PAYROLL')).toBe('co op foods payroll')
  })

  it('reads the merchant name the bank gave, and falls back to the merchant key when nothing is left', () => {
    expect(keyOf('DEPOSIT 0115', 'Side Gig')).toBe('side gig')
    expect(keyOf('PPD WEB')).toBe('ppd web')
  })
})

describe('a payment into a card or loan', () => {
  const credit = (fields: Partial<Transaction>) =>
    paysDownDebt(madeUpTransaction({ amountCents: -5000, ...fields }))

  it('reads loan payment codes and the words cards use for a payment received', () => {
    expect(credit({ name: 'PAYMENT', bankCategory: 'LOAN_PAYMENTS_CAR_PAYMENT' })).toBe(true)
    expect(credit({ name: 'X', bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })).toBe(true)
    for (const name of [
      'PAYMENT THANK YOU',
      'AUTOPAY PAYMENT',
      'ONLINE PAYMENT',
      'PAYMENT RECEIVED',
      'MOBILE PAYMENT',
      'EPAYMENT',
      'E-PAYMENT',
      'PAYMENT - THANK YOU',
      'AUTOMATIC PAYMENT',
      'PYMT RECEIVED',
    ]) {
      expect(credit({ name }), name).toBe(true)
    }
  })

  it('leaves refunds, returns, merchant credits and charges alone', () => {
    expect(credit({ name: 'IKEA REFUND' })).toBe(false)
    expect(credit({ name: 'AMAZON RETURN' })).toBe(false)
    expect(
      credit({ name: 'BEST BUY CREDIT', bankCategory: 'GENERAL_MERCHANDISE_ELECTRONICS' }),
    ).toBe(false)
    expect(credit({ name: 'ONLINE PAYMENT REFUND' })).toBe(false)
    expect(credit({ name: 'PAYMENT THANK YOU', amountCents: 5000 })).toBe(false)
  })

  it('leaves an autopay discount alone, and lets refund words beat a loan payment code', () => {
    expect(credit({ name: 'AUTOPAY DISCOUNT' })).toBe(false)
    expect(credit({ name: 'AUTOPAY CREDIT' })).toBe(false)
    expect(credit({ name: 'ESCROW REFUND', bankCategory: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' })).toBe(
      false,
    )
  })
})
