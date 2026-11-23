// Child support and alimony among money filed as income: never pay, read
// from support words, a State Disbursement Unit or an order withholding it
// from wages, while an employer's pay stays pay. Pure, so no database.

import { describe, expect, it } from 'vitest'
import { incomeLine } from '../src/domain/tax/incomeLine.js'
import type { Transaction } from '../src/domain/transactions.js'
import { madeUpTransaction } from './fixtures/transaction.js'

describe('support among money filed as income', () => {
  /** The line of a made-up deposit. */
  const lineOf = (fields: Partial<Transaction>) =>
    incomeLine(madeUpTransaction({ amountCents: -1000, ...fields }))

  it('notes child support the bank calls money moved in as support', () => {
    expect(lineOf({ name: 'CO CHILD SUPPORT SDU', bankCategory: 'TRANSFER_IN_DEPOSIT' })).toBe(
      'support',
    )
    expect(lineOf({ name: 'TRANSFER FROM SAVINGS', bankCategory: 'TRANSFER_IN_ACCOUNT' })).toBe(
      'moved_in',
    )
  })

  it('never reads child support or alimony as pay, with or without a broad code', () => {
    for (const fields of [
      { name: 'TX CHILD SUPPORT SDU' },
      { name: 'CHILD SUPPORT PAYMENT', bankCategory: 'INCOME_OTHER_INCOME' },
      { name: 'ALIMONY' },
      { name: 'SPOUSAL SUPPORT' },
      { name: 'CA SDU DIR DEP' },
      { name: 'SUPPORT PMT', merchantName: 'State Disbursement' },
      { name: 'DEPT OF CHILD SUPPORT SERVICES' },
      { name: 'SUPPORT PAYMENT', merchantName: 'County Child Services' },
      // A state's own disbursement unit, and "SUPP" short for support.
      { name: 'MISDU PAYMENT' },
      { name: 'PA SCDU PAYMENT' },
      { name: 'NYS CHILD SUPP DEP' },
      // Withheld from a payer's wages by order, so its wages word is not an employer's.
      { name: 'CHILD SUPPORT WAGE WITHHOLDING' },
      { name: 'SPOUSAL SUPPORT INCOME WITHHOLDING' },
    ]) {
      expect(lineOf(fields), fields.name).toBe('support')
    }
  })

  it('reads a disbursement unit only as a whole word, so names with those letters stay pay', () => {
    for (const name of [
      'ACME PAYROLL',
      'WAGES ACME',
      'ROSSDUNE MEDIA',
      'HUDSDUCK DESIGN LLC',
      'GRASSDUMPLING CO',
      'CHILD SUPPLY CO',
      // A wages word with no support word is an employer's.
      'ACME WAGE WITHHOLDING REFUND',
    ]) {
      expect(lineOf({ name }), name).toBe('pay')
    }
  })

  it('reads payroll, salary and wages over support words, and support alone as pay', () => {
    for (const fields of [
      // A child support agency's own staff are paid wages.
      { name: 'DEPT OF CHILD SUPPORT SERVICES PAYROLL' },
      { name: 'SDU SALARY' },
      { name: 'CHILD SUPPORT AGENCY WAGES' },
      // A freelancer's support work, with no child or spousal word.
      { name: 'TECH SUPPORT PAYMENT', bankCategory: 'INCOME_OTHER_INCOME' },
      { name: 'IT SUPPORT PMT' },
    ]) {
      expect(lineOf(fields), fields.name).toBe('pay')
    }
  })
})
