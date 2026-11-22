// The tax export's pure parts that sum the year and write the CSV, without a
// database (taxClassify.test.ts reads single transactions).

import { describe, expect, it } from 'vitest'
import { csvCell, taxCsv } from '../src/domain/tax/csv.js'
import { withTransactions } from '../src/domain/tax/export.js'
import { summarize, type TaxRow, type TaxRowCategory } from '../src/domain/tax/summary.js'
import type { Transaction } from '../src/domain/transactions.js'
import { madeUpTransaction } from './fixtures/transaction.js'

const transaction = madeUpTransaction

const income: TaxRowCategory = { id: 'cat-income', name: 'Income', group: null, kind: 'income' }

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

  it('groups a payer by its payer key, named as its first line shows it', () => {
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
      { id: 'gone', category: null, onDebtAccount: false },
      { id: 'kept', category: income, onDebtAccount: false },
    ]
    expect(withTransactions(rows, [kept])).toEqual([{ tx: kept, category: income }])
  })

  it('skips an unfiled payment into a card or loan, and nothing else on one', () => {
    const payment = transaction({ id: 'pay', name: 'PAYMENT THANK YOU', amountCents: -5000 })
    const refund = transaction({ id: 'refund', name: 'IKEA REFUND', amountCents: -5000 })
    const filedPayment = transaction({ id: 'filed', name: 'PAYMENT THANK YOU', amountCents: -5000 })
    const onChecking = transaction({ id: 'checking', name: 'ONLINE PAYMENT', amountCents: -5000 })
    const rows = [
      { id: 'pay', category: null, onDebtAccount: true },
      { id: 'refund', category: null, onDebtAccount: true },
      { id: 'filed', category: income, onDebtAccount: true },
      { id: 'checking', category: null, onDebtAccount: false },
    ]
    const joined = withTransactions(rows, [payment, refund, filedPayment, onChecking])
    expect(joined.map((row) => row.tx.id)).toEqual(['refund', 'filed', 'checking'])
  })
})
