// Turning a mapped table into rows to save, and naming the rows that cannot be read.

import { describe, expect, it } from 'vitest'
import type { ColumnMapping } from './mapping'
import { parseCsv } from './parse'
import { accountsInFile, countRepeats, missingColumn, prepareRows } from './rows'

const base: ColumnMapping = {
  date: 0,
  description: 1,
  amount: { kind: 'signed', column: 2 },
  category: null,
  account: null,
  dateFormat: 'mdy',
  decimalMark: '.',
  flip: false,
}

const table = (text: string) => parseCsv(text, true)

describe('preparing rows', () => {
  it('reads each row by the mapping', () => {
    const result = prepareRows(table('d,n,a\n11/02/2026,Coffee,4.50\n11/03/2026,Pay,-2500'), base)
    expect(result).toEqual({
      rows: [
        { date: '2026-11-02', name: 'Coffee', amountCents: 450, category: null },
        { date: '2026-11-03', name: 'Pay', amountCents: -250000, category: null },
      ],
      problems: [],
    })
  })

  it('flips signs for a file that shows spending as negative, never making -0', () => {
    const { rows } = prepareRows(table('d,n,a\n11/02/2026,Coffee,-4.50\n11/03/2026,Zero,0'), {
      ...base,
      flip: true,
    })
    expect(rows.map((row) => row.amountCents)).toEqual([450, 0])
    expect(Object.is(rows[1]!.amountCents, 0)).toBe(true)
  })

  it('reads money out and money in columns, whatever sign they carry', () => {
    const split: ColumnMapping = { ...base, amount: { kind: 'split', debit: 2, credit: 3 } }
    const { rows, problems } = prepareRows(
      table(
        'd,n,out,in\n11/02/2026,Coffee,4.50,\n11/03/2026,Pay,,2500\n11/04/2026,Fee,-1.00,\n11/05/2026,Both,10,4\n11/06/2026,None,,',
      ),
      split,
    )
    expect(rows.map((row) => row.amountCents)).toEqual([450, -250000, 100, 600])
    expect(problems).toEqual([{ row: 6, reason: 'has no amount' }])
  })

  it('names a bad money out or money in cell', () => {
    const split: ColumnMapping = { ...base, amount: { kind: 'split', debit: 2, credit: 3 } }
    const { problems } = prepareRows(
      table('d,n,out,in\n11/02/2026,A,abc,\n11/03/2026,B,,xyz'),
      split,
    )
    expect(problems).toEqual([
      { row: 2, reason: 'has "abc", which is not an amount' },
      { row: 3, reason: 'has "xyz", which is not an amount' },
    ])
  })

  it('reads an amount with a type column', () => {
    const typed: ColumnMapping = { ...base, amount: { kind: 'direction', column: 2, direction: 3 } }
    const { rows, problems } = prepareRows(
      table(
        'd,n,a,t\n1/02/2020,Coffee,4.50,debit\n1/03/2020,Pay,2500,credit\n1/04/2020,Odd,-3,DR\n1/05/2020,What,1,sale',
      ),
      typed,
    )
    expect(rows.map((row) => row.amountCents)).toEqual([450, -250000, 300])
    expect(problems).toEqual([
      { row: 5, reason: 'has "sale", which does not say if money went out or came in' },
    ])
  })

  it('names each row it cannot read, and why, and keeps the rest', () => {
    const { rows, problems } = prepareRows(
      table(
        'd,n,a\n13/45/2026,Bad date,1\n,No date,1\n11/02/2026,,1\n11/02/2026,Bad amount,abc\n11/02/2026,No amount,\n11/02/2026,Huge,2000000000\n11/02/2026,Fine,1',
      ),
      base,
    )
    expect(rows.map((row) => row.name)).toEqual(['Fine'])
    expect(problems).toEqual([
      { row: 2, reason: 'has "13/45/2026", which is not a date' },
      { row: 3, reason: 'has no date' },
      { row: 4, reason: 'has no description' },
      { row: 5, reason: 'has "abc", which is not an amount' },
      { row: 6, reason: 'has no amount' },
      { row: 7, reason: 'has an amount too large to be real' },
    ])
  })

  it('numbers rows from 1 when the file has no header row', () => {
    const { problems } = prepareRows(parseCsv('11/02/2026,Coffee,4.50\nlater,Pay,1', false), base)
    expect(problems).toEqual([{ row: 2, reason: 'has "later", which is not a date' }])
  })

  it('tidies descriptions and cuts long cells to what the server takes', () => {
    const long = 'x'.repeat(250)
    const { rows } = prepareRows(
      table(`d,n,a,c\n11/02/2026,"  Coffee \n  shop ",1,${long}\n11/03/2026,${long},1,  `),
      { ...base, category: 3 },
    )
    expect(rows[0]).toMatchObject({ name: 'Coffee shop', category: 'x'.repeat(80) })
    expect(rows[1]).toMatchObject({ name: 'x'.repeat(200), category: null })
  })

  it('keeps one account of a file that holds several', () => {
    const text = 'd,n,a,acct\n11/02/2026,A,1,Checking\n11/03/2026,B,2,Card\n11/04/2026,C,3,Checking'
    const mapping = { ...base, account: 3 }
    expect(prepareRows(table(text), mapping, 'Checking').rows.map((row) => row.name)).toEqual([
      'A',
      'C',
    ])
    expect(prepareRows(table(text), mapping, null).rows).toHaveLength(3)
    // Without an account column the choice does nothing.
    expect(prepareRows(table(text), base, 'Checking').rows).toHaveLength(3)
  })

  it('reads nothing until the date, description and amount are chosen', () => {
    const text = table('d,n,a\n11/02/2026,A,1')
    expect(prepareRows(text, { ...base, date: null })).toEqual({ rows: [], problems: [] })
    expect(missingColumn({ ...base, date: null })).toBe('Choose the column with the date.')
    expect(missingColumn({ ...base, description: null })).toBe(
      'Choose the column with the description.',
    )
    expect(missingColumn({ ...base, amount: null })).toBe('Choose the column with the amount.')
    expect(missingColumn(base)).toBeNull()
  })
})

describe('accounts named in a file', () => {
  it('counts rows per account, most first, then by name', () => {
    const text = table(
      'd,n,a,acct\n1/1/26,A,1,Card\n1/2/26,B,1,Checking\n1/3/26,C,1,Checking\n1/4/26,D,1,Brokerage',
    )
    expect(accountsInFile(text, 3)).toEqual([
      { name: 'Checking', rows: 2 },
      { name: 'Brokerage', rows: 1 },
      { name: 'Card', rows: 1 },
    ])
    expect(accountsInFile(text, null)).toEqual([])
  })
})

describe('counting repeats', () => {
  it('counts rows equal to an earlier one, by the server duplicate rule', () => {
    const coffee = { date: '2026-11-02', name: 'Coffee', amountCents: 450, category: null }
    expect(
      countRepeats([
        coffee,
        { ...coffee, name: 'COFFEE!' },
        { ...coffee, amountCents: 451 },
        coffee,
      ]),
    ).toBe(2)
    expect(countRepeats([])).toBe(0)
  })
})
