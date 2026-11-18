// Reading CSV text as banks and budgeting apps write it.

import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv, parseRecords } from './parse'

describe('splitting records', () => {
  it('splits plain fields and lines', () => {
    expect(parseRecords('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps separators, line breaks and doubled quotes inside quotes', () => {
    const text = 'name,note\n"Smith, Jo","said ""hi""\nthen left"\n'
    expect(parseRecords(text, ',')).toEqual([
      ['name', 'note'],
      ['Smith, Jo', 'said "hi"\nthen left'],
    ])
  })

  it('reads Windows, Unix and old Mac line endings alike', () => {
    const expected = [
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]
    expect(parseRecords('a,b\r\n1,2\r\n3,4\r\n', ',')).toEqual(expected)
    expect(parseRecords('a,b\r1,2\r3,4', ',')).toEqual(expected)
    expect(parseRecords('a,b\n1,2\n3,4\n', ',')).toEqual(expected)
  })

  it('drops a byte order mark and blank lines', () => {
    expect(parseRecords('\uFEFFdate,amount\n\n2026-01-02,5\n , \n', ',')).toEqual([
      ['date', 'amount'],
      ['2026-01-02', '5'],
    ])
  })

  it('keeps empty fields, including quoted empty ones and a trailing one', () => {
    expect(parseRecords('a,,c,\n"",x,"",', ',')).toEqual([
      ['a', '', 'c', ''],
      ['', 'x', '', ''],
    ])
  })

  it('reads a quote in the middle of a field as text', () => {
    expect(parseRecords('5" pipe,2', ',')).toEqual([['5" pipe', '2']])
  })

  it('keeps text after a closing quote, and runs an unclosed quote to the end', () => {
    expect(parseRecords('"a"b,c', ',')).toEqual([['ab', 'c']])
    expect(parseRecords('x,"never closed\nmore', ',')).toEqual([['x', 'never closed\nmore']])
  })

  it('splits on semicolons, tabs and pipes', () => {
    expect(parseRecords('a;b\n1,5;2', ';')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ])
    expect(parseRecords('a\tb', '\t')).toEqual([['a', 'b']])
    expect(parseRecords('a|b', '|')).toEqual([['a', 'b']])
  })

  it('reads nothing from an empty file', () => {
    expect(parseRecords('', ',')).toEqual([])
    expect(parseRecords('\n\r\n', ',')).toEqual([])
  })
})

describe('finding the separator', () => {
  it('picks the comma for a plain file', () => {
    expect(detectDelimiter('date,description,amount\n2026-01-02,Coffee,4.50')).toBe(',')
  })

  it('picks the semicolon when amounts use decimal commas', () => {
    expect(
      detectDelimiter('Datum;Omschrijving;Bedrag\n02-01-2026;Koffie;-3,50\n03-01-2026;Brood;-2,10'),
    ).toBe(';')
  })

  it('picks tabs and pipes', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a|b\n1|2')).toBe('|')
  })

  it('ignores separators inside quotes', () => {
    expect(detectDelimiter('a;b\n"x, y, z";2\n"p, q";3')).toBe(';')
  })

  it('falls back to the comma when nothing splits the lines', () => {
    expect(detectDelimiter('one column\nvalue')).toBe(',')
    expect(detectDelimiter('')).toBe(',')
  })
})

describe('reading a whole file', () => {
  it('names columns from the header row and trims cells', () => {
    expect(parseCsv('Date, Description ,Amount\n2026-01-02, Coffee ,-4.50\n')).toEqual({
      columns: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-02', 'Coffee', '-4.50']],
      hasHeader: true,
      delimiter: ',',
    })
  })

  it('numbers the columns of a file with no header', () => {
    const table = parseCsv(
      '"01/02/2026","-12.34","*","","PURCHASE COFFEE"\n"01/03/2026","500.00","*","","PAYROLL"',
    )
    expect(table.hasHeader).toBe(false)
    expect(table.columns).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5'])
    expect(table.rows).toHaveLength(2)
  })

  it('lets the owner say whether the first row is a header', () => {
    expect(parseCsv('a,b\nc,d', false).rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsv('2026-01-02,5\n2026-01-03,6', true).columns).toEqual(['2026-01-02', '5'])
  })

  it('names a blank header cell by its position', () => {
    expect(parseCsv('Date,,Amount\n2026-01-02,x,5').columns).toEqual(['Date', 'Column 2', 'Amount'])
  })

  it('skips an account summary above the table', () => {
    const text = [
      'Description,,Summary Amt.',
      'Beginning balance as of 01/01/2026,,"1,000.00"',
      'Ending balance as of 01/31/2026,,"900.00"',
      '',
      'Date,Description,Amount,Running Bal.',
      '01/02/2026,Coffee,-4.50,995.50',
      '01/03/2026,Groceries,-95.50,900.00',
      '01/04/2026,Refund,10.00,910.00',
      '01/05/2026,Lunch,-10.00,900.00',
    ].join('\n')
    const table = parseCsv(text)
    expect(table.columns).toEqual(['Date', 'Description', 'Amount', 'Running Bal.'])
    expect(table.rows).toHaveLength(4)
  })

  it('pads short rows and cuts long ones to the table width', () => {
    const table = parseCsv('a,b,c\n1,2,3\n4,5,6\n7\n8,9,10,11')
    expect(table.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '', ''],
      ['8', '9', '10'],
    ])
  })

  it('reads an empty file as an empty table', () => {
    expect(parseCsv('')).toEqual({ columns: [], rows: [], hasHeader: true, delimiter: ',' })
  })
})
