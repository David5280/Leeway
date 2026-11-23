import { describe, expect, it } from 'vitest'
import { parseMoney } from './typedMoney'

describe('parseMoney', () => {
  it.each([
    ['12.50', 1250],
    ['1200', 120000],
    ['12,5', 1250],
    ['12.5', 1250],
    ['1.50', 150],
    ['.5', 50],
    ['12.', 1200],
    ['0', 0],
    ['+50', 5000],
    // Half a cent rounds up, from the digits typed rather than a float.
    ['1.0050', 101],
    ['0.0049', 0],
    ['12.9990', 1300],
  ])('reads the plain amount %j as %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents)
  })

  it.each([
    ['$1,200', 120000],
    ['12,345', 1234500],
    ['1,234.56', 123456],
    ['1,234,567.89', 123456789],
    ['1.234.567', 123456700],
    // Comma decimals with dot groups, as much of Europe writes them.
    ['1.234,56', 123456],
    ['1.234.567,89', 123456789],
    // Spaces and apostrophes group too: "1 234,56" in France, "1'234.50" in Switzerland.
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ["1'234.50", 123450],
    ['1’234.50', 123450],
    ['1 234 567,89', 123456789],
    ['1 234.56', 123456],
    ['$ 1 200', 120000],
    ['1 234 €', 123400],
  ])('reads thousands in %j as %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents)
  })

  it.each([
    // A dot before exactly three digits is a decimal point in one locale and a
    // thousands mark in another, so it could be 1234 or 1.23.
    '1.234',
    '12.500',
    '0.500',
    '.500',
    '$1.234',
    // Marks that group nothing, or a second decimal mark.
    '1,2,3',
    '1.23.4',
    '1,2.34',
    '12,3456.7',
    '1.234,5.6',
    '1,234.5,6',
    '1234,567',
    // A comma decimal takes one or two digits: "1,0000" is likelier a slipped 1,000 than $1.00.
    '1,0000',
    '10,0000',
    '12,3456',
    '1.234,567',
    '1.234,5678',
    '1 234,5678',
    // A space or apostrophe that groups no thousands, or a mix of them.
    '1,000 000',
    '1,234 567',
    '12 50',
    "12'50",
    '1 0000',
    '1 23',
    '1234 567',
    "1 234'567",
    '1 234 56',
  ])('refuses %j, whose marks could mean two amounts or none', (text) => {
    expect(parseMoney(text)).toBeNull()
  })

  it.each([
    // Letters typed for digits, which reading round would make far smaller amounts.
    '5e1',
    '1O0',
    '1,2OO',
    '1OOO',
    '5OO',
    '6O',
    'l00',
    'I50',
    '12e3',
    // Shorthand for thousands, millions, billions, crores and cents.
    '1.2k',
    '10K',
    '5k',
    '2MM',
    '1.5mm',
    '5 mil',
    '3bn',
    '5m',
    '5b',
    '2 cr',
    '99 ct',
    // Characters an amount never holds.
    '1/2',
    '5%',
    '12*',
    '1_000',
    // Nothing to read.
    'abc',
    '',
    '   ',
    '.',
    '-',
    '$',
  ])('refuses %j rather than read a smaller amount', (text) => {
    expect(parseMoney(text)).toBeNull()
  })

  it.each([
    ['12,5', 1250],
    ['12,50', 1250],
    ['12,', 1200],
    [',5', 50],
    ['1.234,5', 123450],
  ])('reads the comma decimal %j as %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents)
  })

  it('refuses a paste longer than any amount, without reading it', () => {
    const padded = `${' '.repeat(60)}1200`
    expect(parseMoney(padded)).toBe(120000)
    expect(parseMoney(` ${padded}`)).toBeNull()
    const started = performance.now()
    expect(parseMoney(`${'a'.repeat(100_000)}1`)).toBeNull()
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('refuses an amount too large to count in cents exactly', () => {
    expect(parseMoney('99999999999999999')).toBeNull()
    expect(parseMoney('90071992547409.91')).toBe(9007199254740991)
  })
})

describe('parseMoney with a sign', () => {
  it.each([
    ['-12.50', -1250],
    ['-$5', -500],
    ['$-5', -500],
    ['- 5', -500],
    // The true minus sign, as a phone keyboard may type it, reads as the plain one.
    ['−12.50', -1250],
    ['−$1,234.56', -123456],
    // Brackets, as accounts write money owed.
    ['(45.00)', -4500],
    ['($45.00)', -4500],
    [' (1,234.56) ', -123456],
    ['(USD 45)', -4500],
    ['(45 kr)', -4500],
  ])('reads %j as negative, %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents)
  })

  it('reads minus zero as plain zero', () => {
    expect(parseMoney('-0')).toBe(0)
    expect(parseMoney('(0.00)')).toBe(0)
  })

  it.each([
    // A currency sign in the middle, or more than one.
    '12€50',
    '1$5',
    '12 €50',
    '$5$',
    '$-$5',
    '€12 €',
    '$$5',
    '5 - $',
  ])('refuses %j, its currency sign out of place', (text) => {
    expect(parseMoney(text)).toBeNull()
  })

  it.each(['(-45)', '(+45)', '(45', '45)', '((45))', '-(45)', '$(45)', '5-', '--5', '+-5', '5-3'])(
    'refuses %j, whose sign makes no sense',
    (text) => {
      expect(parseMoney(text)).toBeNull()
    },
  )
})

describe('parseMoney with a currency', () => {
  it.each([
    ['5 eur', 500],
    ['EUR 5', 500],
    ['12,50 €', 1250],
    ['€12', 1200],
    ['R$ 12,50', 1250],
    ['CHF 12.50', 1250],
    ['12 USD', 1200],
    ['USD1,200', 120000],
    ['USD .50', 50],
    ['120kr', 12000],
    ['kr. 50', 5000],
    ['US$5', 500],
    ['NZ$5', 500],
    ['US $5', 500],
    ['C$5', 500],
    ['A$5', 500],
    ['HK$5', 500],
    ['S$5', 500],
    ['12 zł', 1200],
    ['Rs. 500', 50000],
    ['500 Rs.', 50000],
    ['Fr. 12.50', 1250],
    ['R 100', 10000],
    ['RM 50', 5000],
    ['50 TL', 5000],
    ['1.234,56 EUR', 123456],
  ])('reads %j, its currency in letters or signs, as %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents)
  })

  it.each([
    // A code is never written with a dot.
    '12 USD.',
    // A currency in the middle, or one named twice at one end.
    '12 USD 5',
    '5 EUR EUR',
    // A code on a dot: 50 cents, or a slipped 50?
    'USD.50',
    'EUR.50',
    // Letters on a sign that are no dollar's: typos, not a currency.
    'ABCD$5',
    'OO$5',
    'lO$5',
    'mm$5',
    // A currency outside brackets: written either way round, it stays unread.
    'USD (45)',
    'EUR',
  ])('refuses %j', (text) => {
    expect(parseMoney(text)).toBeNull()
  })
})
