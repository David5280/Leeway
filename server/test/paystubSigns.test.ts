// Amounts a paystub signs against its other lines of that kind: a refund or
// a reversal. Leeway reads every amount as positive and never subtracts, so
// such a line is marked for the owner to check. Every reading is fixed.

import { describe, expect, it } from 'vitest'
import { signOf } from '../src/domain/paystubs/amounts.js'
import { extractionFrom } from '../src/domain/paystubs/reading.js'
import { signedAgainst } from '../src/domain/paystubs/signs.js'
import { CITY_READING, readLine } from './fixtures/paystub.js'

/** The city reading with some lines changed. */
function cityWith(change: (reading: typeof CITY_READING) => void) {
  const reading = structuredClone(CITY_READING)
  change(reading)
  return reading
}

const neither = { current: false, yearToDate: false }

describe('signOf', () => {
  it('reads a minus before or after, or parentheses, as negative, and mixed parts as mixed', () => {
    expect(signOf(null)).toBeNull()
    expect(signOf('1,234.56')).toBe('plus')
    for (const printed of ['-12.50', '12.50-', '(12.50)', '$(12.50)', '(12.50) + -1.00']) {
      expect(signOf(printed)).toBe('minus')
    }
    expect(signOf('150.00 + (50.00)')).toBe('mixed')
  })

  it('gives a zero or a blank no sign, since neither is marked', () => {
    for (const printed of ['0.00', '-0.00', '(0.00)', '', ' ']) expect(signOf(printed)).toBeNull()
  })

  it('reads a joined amount by its parts that are not zero', () => {
    expect(signOf('0.00 + (12.50)')).toBe('minus')
    expect(signOf('(0.00) + 12.50')).toBe('plus')
    expect(signOf('0.00 + 0.00')).toBeNull()
  })
})

describe('signedAgainst', () => {
  it('flags nothing on a stub that marks its lines one way', () => {
    const flags = signedAgainst(CITY_READING)
    expect(flags.pay.gross).toEqual(neither)
    expect(flags.preTax.pension).toEqual(neither)
  })

  it('takes each column as the stub marks it, so negative deductions this period are usual', () => {
    // Deductions printed "-350.00" this period and plain for the year, as many stubs do.
    const signed = cityWith((reading) => {
      for (const group of [reading.taxes, reading.preTax, reading.postTax]) {
        for (const line of Object.values(group)) {
          if (line.current !== null) line.current = `-${line.current}`
        }
      }
    })
    const flags = signedAgainst(signed)
    expect(flags.taxes.federalIncome).toEqual(neither)
    expect(flags.preTax.plan457).toEqual(neither)
  })

  it('lets no printed zero vote, so set-up deductions at 0.00 flag nothing', () => {
    // Deductions negative this period, plain for the year, with five set-up deductions at zero.
    const signed = cityWith((reading) => {
      for (const group of [reading.taxes, reading.preTax, reading.postTax]) {
        for (const line of Object.values(group)) {
          if (line.current !== null) line.current = `-${line.current}`
        }
      }
      reading.preTax.hsa = readLine('0.00', '500.00')
      for (const kind of ['fsa', 'dental', 'vision', 'commuter'] as const) {
        reading.preTax[kind] = readLine('0.00', '0.00')
      }
    })
    const flags = signedAgainst(signed)
    expect(flags.preTax.hsa).toEqual(neither)
    expect(flags.taxes.federalIncome).toEqual(neither)
    expect(flags.preTax.plan457).toEqual(neither)
  })

  it('flags a negative pay or earnings line, and a mixed amount anywhere', () => {
    const flags = signedAgainst(
      cityWith((reading) => {
        reading.earnings.other = readLine('(150.00)')
        reading.pay.net = readLine('2,611.42', '-1.00')
        reading.preTax.health = readLine('50.00 + (10.00)')
      }),
    )
    expect(flags.earnings.other).toEqual({ current: true, yearToDate: false })
    expect(flags.pay.net).toEqual({ current: false, yearToDate: true })
    expect(flags.preTax.health.current).toBe(true)
  })

  it("checks both of the employer's lines when they disagree, as neither way is the usual one", () => {
    const flags = signedAgainst(
      cityWith((reading) => {
        reading.employer.match = readLine('(20.00)')
      }),
    )
    expect(flags.employer.match.current).toBe(true)
    expect(flags.employer.pension.current).toBe(true)
  })
})

describe('a refund among the lines', () => {
  it('keeps the amount as printed but marks the line and its import figure to check', () => {
    // A Roth refund printed "100.00-" among plain deductions; read as 100.00, never subtracted.
    const { detail, current } = extractionFrom(
      cityWith((reading) => {
        reading.preTax.plan401k = readLine('250.00')
        reading.postTax.roth401k = readLine('100.00-', null, 'Roth 401k Refund 100.00-')
      }),
    )
    expect(detail.postTax.roth401k).toMatchObject({ current: 10_000, confidence: 'low' })
    expect(current.plan401k).toMatchObject({ cents: 35_000, confidence: 'low' })
    // The lines around it are untouched.
    expect(detail.preTax.plan401k.confidence).toBe('high')
  })
})
