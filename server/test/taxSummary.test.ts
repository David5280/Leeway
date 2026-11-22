// The tax export's pure parts: reading a transaction, summing the year and
// writing the CSV, without a database.

import { describe, expect, it } from 'vitest'
import { incomeLine, mayBeDeductible } from '../src/domain/tax/classify.js'
import { csvCell, taxCsv } from '../src/domain/tax/csv.js'
import { withTransactions } from '../src/domain/tax/export.js'
import { summarize, type TaxRow, type TaxRowCategory } from '../src/domain/tax/summary.js'
import type { Transaction } from '../src/domain/transactions.js'

/** A made-up transaction, money out unless the amount says otherwise. */
function transaction(fields: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acct-1',
    accountName: 'Everyday',
    date: '2026-03-01',
    name: 'SHOP',
    merchantName: null,
    displayName: 'Shop',
    amountCents: 1000,
    currency: 'USD',
    pending: false,
    categoryId: null,
    categorySource: null,
    bankCategory: null,
    note: null,
    excluded: false,
    manual: false,
    source: 'bank',
    person: null,
    transfer: null,
    ...fields,
  }
}

const income: TaxRowCategory = { id: 'cat-income', name: 'Income', group: null, kind: 'income' }

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
    incomeLine(transaction({ amountCents: -1000, ...fields }))

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
    expect(lineOf({ name: 'DEPOSIT', merchantName: 'Card Rewards' })).toBe('rewards')
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
    expect(lineOf({ name: 'IRS TREAS 310 TAX REF' })).toBe('tax_refund')
  })

  it('reads pay words first, so a paycheck whose words also name another kind is pay', () => {
    for (const fields of [
      { name: 'REWARDS NETWORK INC PAYROLL' },
      { name: 'PENSION FUND ADMIN DIR DEP' },
      { name: 'CASH BACK CAR WASH LLC PAYROLL' },
      { name: 'Direct Deposit', merchantName: 'Cash Back Car Wash' },
      { name: 'Payroll TAX REFUND ADJ ACME', bankCategory: 'INCOME' },
      { name: 'SSA TREAS SALARY', bankCategory: 'INCOME_OTHER_INCOME' },
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

describe('the summary', () => {
  it('splits money with no category by direction, never netting a paycheck into spending', () => {
    const rows: TaxRow[] = [
      {
        tx: transaction({ id: 'pay', displayName: 'ACME PAYROLL', amountCents: -300000 }),
        category: null,
      },
      { tx: transaction({ id: 'shop', amountCents: 3000 }), category: null },
    ]
    const summary = summarize(2026, rows)
    expect(summary.categories.map((c) => [c.name, c.moneyIn, c.totalCents])).toEqual([
      ['Money in, not categorized', true, 300000],
      ['Money out, not categorized', false, 3000],
    ])
    expect(summary).toMatchObject({ payCents: 0, unfiledInCents: 300000 })
  })

  it('leaves out a source that nets to nothing, and still adds up to Pay', () => {
    const pay = (id: string, name: string, cents: number) => ({
      tx: transaction({ id, name, displayName: name, amountCents: cents }),
      category: income,
    })
    const rows: TaxRow[] = [
      pay('in', 'Gig', -5000),
      pay('back', 'Gig', 5000),
      pay('job', 'Job', -9000),
    ]
    expect(summarize(2026, rows)).toMatchObject({
      income: [{ key: 'job', source: 'Job', cents: 9000 }],
      payCents: 9000,
    })
  })

  it('groups a payer by its merchant key, named as its first line shows it', () => {
    const pay = (id: string, name: string, displayName: string) => ({
      tx: transaction({ id, name, displayName, amountCents: -100000 }),
      category: income,
    })
    const rows: TaxRow[] = [
      pay('jan', 'ACME PAYROLL 0115', 'Acme Payroll'),
      pay('feb', 'ACME PAYROLL 0215', 'ACME PAYROLL'),
    ]
    expect(summarize(2026, rows).income).toEqual([
      { key: 'acme payroll', source: 'Acme Payroll', cents: 200000 },
    ])
  })

  it('groups payroll deposits as one source, whatever ACH noise and ids the bank adds', () => {
    const pay = (id: string, name: string) => ({
      tx: transaction({ id, name, displayName: name, amountCents: -100000 }),
      category: income,
    })
    const rows: TaxRow[] = [pay('a', 'ACME PAYROLL'), pay('b', 'ACME PAYROLL PPD ID 123')]
    expect(summarize(2026, rows).income).toEqual([
      { key: 'acme payroll', source: 'ACME PAYROLL', cents: 200000 },
    ])
  })

  it('puts benefits, refunds and rewards on their own lines, never in Pay', () => {
    const deposit = (id: string, fields: Partial<Transaction>) => ({
      tx: transaction({ id, amountCents: -10000, ...fields }),
      category: income,
    })
    const rows: TaxRow[] = [
      deposit('ref', { name: 'IRS TREAS 310 TAX REF', bankCategory: 'INCOME_TAX_REFUND' }),
      deposit('ui', { name: 'DES BENEFITS', bankCategory: 'INCOME_UNEMPLOYMENT' }),
      deposit('pen', { name: 'ACME PENSION', bankCategory: 'INCOME_RETIREMENT_PENSION' }),
      deposit('cb', { name: 'CASH BACK REWARD' }),
      deposit('ss', { name: 'SOC SEC 310 SSA TREAS' }),
    ]
    expect(summarize(2026, rows)).toMatchObject({
      payCents: 0,
      income: [],
      taxRefundCents: 10000,
      unemploymentCents: 10000,
      retirementCents: 10000,
      rewardsCents: 10000,
      socialSecurityCents: 10000,
    })
  })
})

describe('the CSV', () => {
  it('notes each income row that is not pay', () => {
    const rows: TaxRow[] = [
      {
        tx: transaction({ name: 'IRS TREAS 310 TAX REF', amountCents: -2500 }),
        category: income,
      },
    ]
    expect(taxCsv(summarize(2026, rows), rows)).toContain(',25.00,"Tax refund, not pay"\r\n')
  })

  it("puts why income is not pay ahead of the owner's own note", () => {
    const person = { app: 'Zelle', direction: 'in' as const, counterparty: 'Sam' }
    const rows: TaxRow[] = [
      {
        tx: transaction({ amountCents: -5000, person, note: 'Concert tickets' }),
        category: income,
      },
    ]
    expect(taxCsv(summarize(2026, rows), rows)).toContain(
      ',50.00,"Payment from a person, not pay; Concert tickets"\r\n',
    )
  })

  it('quotes what needs quoting and keeps a spreadsheet from running a formula', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('Café Olé')).toBe('Café Olé')
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('=1+2')).toBe("'=1+2")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })
})

describe('joining the rows to their transactions', () => {
  it('skips a row whose transaction was deleted between the two reads', () => {
    const kept = transaction({ id: 'kept' })
    const rows = [
      { id: 'gone', category: null },
      { id: 'kept', category: income },
    ]
    expect(withTransactions(rows, [kept])).toEqual([{ tx: kept, category: income }])
  })
})
