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
  it('reads interest and dividends by bank code', () => {
    expect(incomeLine({ bankCategory: 'INCOME_INTEREST_EARNED', person: null })).toBe('interest')
    expect(incomeLine({ bankCategory: 'INCOME_DIVIDENDS', person: null })).toBe('dividends')
  })

  it('keeps a payment from a person and money moved in out of pay, whatever the category is called', () => {
    const person = { app: 'Venmo', direction: 'in' as const, counterparty: 'Sam' }
    expect(incomeLine({ bankCategory: 'INCOME_WAGES', person })).toBe('person')
    expect(incomeLine({ bankCategory: 'TRANSFER_IN_DEPOSIT', person: null })).toBe('moved_in')
  })

  it('reads anything else as pay', () => {
    expect(incomeLine({ bankCategory: 'INCOME_WAGES', person: null })).toBe('pay')
    expect(incomeLine({ bankCategory: null, person: null })).toBe('pay')
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
      ['Not categorized', false, 3000],
    ])
    expect(summary).toMatchObject({ payCents: 0, unfiledInCents: 300000 })
  })

  it('leaves out a source that nets to nothing, and still adds up to Pay', () => {
    const rows: TaxRow[] = [
      { tx: transaction({ id: 'in', displayName: 'Gig', amountCents: -5000 }), category: income },
      { tx: transaction({ id: 'back', displayName: 'Gig', amountCents: 5000 }), category: income },
      { tx: transaction({ id: 'job', displayName: 'Job', amountCents: -9000 }), category: income },
    ]
    expect(summarize(2026, rows)).toMatchObject({
      income: [{ source: 'Job', cents: 9000 }],
      payCents: 9000,
    })
  })
})

describe('the CSV', () => {
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
