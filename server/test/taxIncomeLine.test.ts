// Which income line money filed under an income category counts on: by its
// bank code, the payment app it went through, or its words. Pure, so no
// database.

import { describe, expect, it } from 'vitest'
import { incomeLine } from '../src/domain/tax/incomeLine.js'
import type { Transaction } from '../src/domain/transactions.js'
import { madeUpTransaction } from './fixtures/transaction.js'

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

  it('reads an agency named in full in the description or merchant name', () => {
    const fromAgency = (merchantName: string) => lineOf({ name: 'ACH CREDIT', merchantName })
    expect(fromAgency('Social Security Administration')).toBe('social_security')
    expect(fromAgency('Internal Revenue Service')).toBe('tax_refund')
    expect(fromAgency('IRS')).toBe('tax_refund')
    expect(fromAgency('Employment Development Department')).toBe('unemployment')
    expect(fromAgency('Texas Workforce Commission')).toBe('unemployment')
    expect(fromAgency('Unemployment Insurance')).toBe('unemployment')
    expect(lineOf({ name: 'DIRECT DEP', merchantName: 'Ohio Unemployment' })).toBe('unemployment')
    expect(lineOf({ name: 'DIRECT DEP' })).toBe('pay')
  })

  it("reads an agency's own staff pay as pay, unless its ACH text says otherwise", () => {
    for (const name of [
      'TEXAS WORKFORCE COMMISSION PAYROLL',
      'TX WORKFORCE COMMISSION SALARY',
      'EMPLOYMENT DEVELOPMENT DEPT PAYROLL',
      'IRS PAYROLL',
      'INTERNAL REVENUE SERVICE PAYROLL',
      'SOCIAL SECURITY ADMIN PAYROLL',
      // Treasury 220 pays salaries and vendors; 310 pays refunds and benefits.
      'IRS TREAS 220 FED SALARY',
      'IRS TREAS 220 SALARY',
      'IRS TREAS 220',
      'DIR DEP IRS TREAS 220',
      'IRS TREAS 220 VENDOR PAY',
    ]) {
      expect(lineOf({ name }), name).toBe('pay')
    }
    expect(lineOf({ name: 'IRS TREAS 310' })).toBe('tax_refund')
    expect(lineOf({ name: 'IRS TREAS 310 SALARY' })).toBe('tax_refund')
    expect(lineOf({ name: 'IRS TREAS 220 TAX REF' })).toBe('tax_refund')
    // TAX REF counts only within a short gap of IRS TREAS.
    expect(lineOf({ name: `IRS TREAS 220 ${'ADJ '.repeat(25)}TAX REF` })).toBe('pay')
  })

  it("never reads a shop's sales tax refund or a preparer's refund advance as a tax refund", () => {
    for (const name of [
      'SALES TAX REF',
      'SALES TAX RFND',
      'SALES TAX REFUND',
      'TAX REFUND ADVANCE',
      'HRB TAX REFUND ADV',
      'TAX REF ADV',
    ]) {
      expect(lineOf({ name }), name).toBe('pay')
    }
  })

  it('reads the other common agency texts for refunds, benefits and pensions', () => {
    const lines: [string, string][] = [
      ['CO DEPT REV REFUND', 'tax_refund'],
      ['PA DEPT REVENUE REFUND', 'tax_refund'],
      ['SSI TREAS 310', 'social_security'],
      ['UI DD', 'unemployment'],
      ['UC BENEFITS', 'unemployment'],
      ['UIA BENEFITS', 'unemployment'],
      ['TWC-BENEFITS', 'unemployment'],
      ['FL DEO REEMPLOYMENT', 'unemployment'],
      ['OPERS PENSION PAYROLL', 'retirement'],
      ['STATE ANNUITY PAYROLL', 'retirement'],
    ]
    for (const [name, line] of lines) {
      expect(lineOf({ name }), name).toBe(line)
    }
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

  it('reads interest and dividends from a file import or a hand entry, which carry no code', () => {
    const lines: [Partial<Transaction>, string][] = [
      [{ name: 'INTEREST PAID', bankCategory: null }, 'interest'],
      [{ name: 'Interest Earned' }, 'interest'],
      [{ name: 'INTEREST PAYMENT', bankCategory: 'INCOME' }, 'interest'],
      [{ name: 'Interest', bankCategory: 'INCOME_OTHER_INCOME' }, 'interest'],
      [{ name: 'INT PD' }, 'interest'],
      [{ name: 'INT. CREDIT' }, 'interest'],
      [{ name: 'DIVIDEND' }, 'dividends'],
      [{ name: 'Dividend Deposit' }, 'dividends'],
      [{ name: 'DIVIDENDS' }, 'dividends'],
      [{ name: 'DIV EARNED' }, 'dividends'],
    ]
    for (const [fields, line] of lines) {
      expect(lineOf(fields), fields.name).toBe(line)
    }
  })

  it('keeps employer words ahead of interest and dividend words, and short forms alone as pay', () => {
    for (const fields of [
      { name: 'ACME Dividend Corp PAYROLL' },
      { name: 'INTEREST GROUP SALARY' },
      // "INT" and "DIV" alone are often part of another name.
      { name: "INT'L SIGNS LLC" },
      { name: 'STATE DIV OF PARKS' },
      // An interest charge paid back is not interest earned.
      { name: 'INTEREST CHARGE REVERSAL' },
    ]) {
      expect(lineOf(fields), fields.name).toBe('pay')
    }
    // Words in the merchant name are the payer's own.
    expect(lineOf({ name: 'DIRECT DEP', merchantName: 'Interest Media' })).toBe('pay')
  })

  it('never reads child support or alimony as pay, with or without a broad code', () => {
    for (const fields of [
      { name: 'TX CHILD SUPPORT SDU' },
      { name: 'CHILD SUPPORT PAYMENT', bankCategory: 'INCOME_OTHER_INCOME' },
      { name: 'ALIMONY' },
      { name: 'SPOUSAL SUPPORT' },
      { name: 'CA SDU DIR DEP' },
      { name: 'SUPPORT PMT', merchantName: 'State Disbursement' },
    ]) {
      expect(lineOf(fields), fields.name).toBe('support')
    }
  })

  it('reads veterans benefits, which are not taxed, apart from pay', () => {
    expect(lineOf({ name: 'VA BENEFITS TREAS 310' })).toBe('veterans')
    expect(lineOf({ name: 'VACP TREAS 310' })).toBe('veterans')
    expect(lineOf({ name: 'ACH CREDIT', merchantName: 'Veterans Affairs' })).toBe('veterans')
    // The agency's own staff are paid wages.
    expect(lineOf({ name: 'VETERANS AFFAIRS PAYROLL' })).toBe('pay')
  })

  it('reads anything else as pay', () => {
    expect(lineOf({ name: 'ACME PAYROLL', bankCategory: 'INCOME_WAGES' })).toBe('pay')
    expect(lineOf({ name: 'SIDE GIG LLC', bankCategory: null })).toBe('pay')
  })
})
