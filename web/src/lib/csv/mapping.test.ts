// Guessing which column holds what, from real-world export layouts.

import { describe, expect, it } from 'vitest'
import { amountColumnsOf, directionOf, guessMapping } from './mapping'
import { parseCsv } from './parse'

const guess = (text: string, preferred: 'mdy' | 'dmy' = 'mdy') =>
  guessMapping(parseCsv(text), preferred)

describe('guessing columns by name', () => {
  it('reads a typical bank export with one signed amount', () => {
    const mapping = guess(
      [
        'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
        '11/02/2026,11/03/2026,STARBUCKS #12,Food & Drink,Sale,-4.50,',
        '11/04/2026,11/05/2026,PAYROLL,,Payment,2500.00,',
        '11/05/2026,11/06/2026,SAFEWAY,Groceries,Sale,-95.10,',
      ].join('\n'),
    )
    expect(mapping).toEqual({
      date: 0,
      description: 2,
      amount: { kind: 'signed', column: 5 },
      category: 3,
      account: null,
      dateFormat: 'mdy',
      decimalMark: '.',
      // Mostly negative amounts: this file shows spending as negative.
      flip: true,
    })
  })

  it('reads separate money out and money in columns', () => {
    const mapping = guess(
      'Date,Details,Withdrawals,Deposits,Balance\n2026-11-02,Coffee,4.50,,995.50\n2026-11-03,Pay,,2500,3495.50',
    )
    expect(mapping.amount).toEqual({ kind: 'split', debit: 2, credit: 3 })
    expect(mapping.description).toBe(1)
    expect(mapping.flip).toBe(false)
  })

  it("reads Mint's export: positive amounts with a type column", () => {
    const mapping = guess(
      [
        'Date,Description,Original Description,Amount,Transaction Type,Category,Account Name,Labels,Notes',
        '1/02/2020,Coffee,STARBUCKS 123,4.50,debit,Coffee Shops,Chase Checking,,',
        '1/03/2020,Paycheck,ACME PAYROLL,2500.00,credit,Paycheck,Chase Checking,,',
      ].join('\n'),
    )
    expect(mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: { kind: 'direction', column: 3, direction: 4 },
      category: 5,
      account: 6,
      flip: false,
    })
  })

  it('treats a type column without debit or credit words as signed', () => {
    const mapping = guess(
      'Date,Description,Type,Amount\n2026-01-02,Coffee,Sale,-4.50\n2026-01-03,Tea,Sale,-3.00',
    )
    expect(mapping.amount).toEqual({ kind: 'signed', column: 3 })
  })

  it('matches names that contain a known one', () => {
    const mapping = guess(
      'Booking Date,Payee Name,Amount (EUR)\n02.01.2026,Bakery,"-3,50"\n05.01.2026,Shop,"-12,00"',
      'dmy',
    )
    expect(mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: { kind: 'signed', column: 2 },
      decimalMark: ',',
      dateFormat: 'dmy',
    })
  })

  it('leaves a part unmatched when no column fits', () => {
    // No name matches, so the description falls back to the column with the longest text.
    const mapping = guess('When,What\nyesterday,coffee\ntoday,tea')
    expect(mapping).toMatchObject({
      date: null,
      amount: null,
      category: null,
      account: null,
      description: 0,
    })
    expect(mapping.flip).toBe(false)
  })

  it('takes the region date order when the dates do not settle it', () => {
    expect(guess('Date,Description,Amount\n01/02/2026,A,1\n03/04/2026,B,2', 'dmy').dateFormat).toBe(
      'dmy',
    )
    expect(guess('Date,Description,Amount\n01/02/2026,A,1\n03/04/2026,B,2', 'mdy').dateFormat).toBe(
      'mdy',
    )
  })
})

describe('guessing columns without a header', () => {
  it('finds the date, the amount and the longest text', () => {
    const mapping = guess(
      '"01/02/2026","-12.34","*","","PURCHASE AUTHORIZED ON 01/01 COFFEE"\n"01/03/2026","500.00","*","","PAYROLL DEPOSIT ACME"\n"01/04/2026","-40.00","*","","GAS STATION"',
    )
    expect(mapping).toMatchObject({
      date: 0,
      amount: { kind: 'signed', column: 1 },
      description: 4,
      category: null,
      flip: true,
    })
  })

  it('finds nothing in a file of empty cells', () => {
    const mapping = guessMapping(
      { columns: ['Column 1'], rows: [['']], hasHeader: false, delimiter: ',' },
      'mdy',
    )
    expect(mapping).toMatchObject({ date: null, amount: null, description: null })
  })
})

describe('reading a type column', () => {
  it('knows the usual words for money out and in', () => {
    expect(['Debit', 'DR', 'withdrawal', 'Purchase', 'fee'].map(directionOf)).toEqual(
      Array(5).fill('out'),
    )
    expect(['credit', 'CR', 'Deposit', 'refund', 'Interest'].map(directionOf)).toEqual(
      Array(5).fill('in'),
    )
    expect(directionOf('Sale')).toBeNull()
  })
})

describe('the money columns of a mapping', () => {
  it('lists the columns to read amounts from', () => {
    expect(amountColumnsOf({ kind: 'signed', column: 2 })).toEqual([2])
    expect(amountColumnsOf({ kind: 'direction', column: 2, direction: 3 })).toEqual([2])
    expect(amountColumnsOf({ kind: 'split', debit: 4, credit: 5 })).toEqual([4, 5])
  })
})
