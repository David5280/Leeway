// The tax export's reading of single transactions: which categories may be
// deductible, who paid a deposit and whether a credit only pays down a card
// or loan. Which income line a deposit counts on is in taxIncomeLine.test.ts.
// Pure, so no database.

import { describe, expect, it } from 'vitest'
import { mayBeDeductible, paysDownDebt } from '../src/domain/tax/classify.js'
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
    expect(keyOf('STATE OF ID 0115 PAYROLL')).toBe('state of id payroll')
    expect(keyOf('IDX2 PAYROLL')).toBe('idx payroll')
  })

  it('drops a letters only id only after a written "ID:" label', () => {
    expect(keyOf('ACME PAYROLL ID:ABCDEF')).toBe('acme payroll')
    expect(keyOf('ACME ID ABCDEF PAYROLL')).toBe('acme id abcdef payroll')
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

  it("reads Apple Card's payment from a bank account, but never a deposit from a payer", () => {
    expect(credit({ name: 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234' })).toBe(true)
    for (const name of [
      'ACH DEPOSIT ACME PAYROLL',
      'ACH DEPOSIT INTERNET TRANSFER',
      'DIRECT DEPOSIT ACME CORP',
      'TRANSFER FROM ACME PAYROLL',
      // A refund wins over the payment words, as everywhere.
      'INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234 REFUND',
    ]) {
      expect(credit({ name }), name).toBe(false)
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
    expect(credit({ name: 'AUTOPAY-DISCOUNT' })).toBe(false)
    expect(credit({ name: 'AUTOPAY DISC' })).toBe(false)
    expect(credit({ name: 'ESCROW REFUND', bankCategory: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' })).toBe(
      false,
    )
  })
})
