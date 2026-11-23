// A paystub reading in full: the schema the reader fills, every line turned
// into reviewed cents with identifiers taken out, and the import figures
// worked out from those lines. Every reading is fixed; nothing reaches a model.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { REMOVED } from '../src/domain/paystubs/redact.js'
import {
  extractionFrom,
  foundAnything,
  paystubReadingSchema,
} from '../src/domain/paystubs/reading.js'
import { CITY_READING, NOT_A_PAYSTUB, readFigure, readLine } from './fixtures/paystub.js'

/** The city reading with some lines changed. */
function cityWith(change: (reading: typeof CITY_READING) => void) {
  const reading = structuredClone(CITY_READING)
  change(reading)
  return reading
}

describe('paystubReadingSchema', () => {
  it('asks only for strings, enums and nulls, and takes the fixture as written', () => {
    expect(paystubReadingSchema.parse(CITY_READING)).toEqual(CITY_READING)
    const wrong = cityWith((reading) => {
      ;(reading.pay.gross as { current: unknown }).current = 3845
    })
    expect(paystubReadingSchema.safeParse(wrong).success).toBe(false)
  })

  it('stays inside the API limits on strict schemas: no optional fields, at most 16 nullable', () => {
    const schema = zodOutputFormat(paystubReadingSchema).schema as JsonSchema
    const text = JSON.stringify(schema)
    expect((text.match(/"anyOf"|"type":\[/g) ?? []).length).toBeLessThanOrEqual(16)
    expect(optionalFields(schema)).toEqual([])
  })
})

/** A JSON schema node, as far as these checks read it. */
interface JsonSchema {
  properties?: Record<string, JsonSchema>
  required?: string[]
  $defs?: Record<string, JsonSchema>
}

/** Every property in the schema that its object does not require. */
function optionalFields(node: JsonSchema): string[] {
  const own = Object.keys(node.properties ?? {}).filter((key) => !node.required?.includes(key))
  const children = [...Object.values(node.properties ?? {}), ...Object.values(node.$defs ?? {})]
  return [...own, ...children.flatMap(optionalFields)]
}

describe('extractionFrom, in full', () => {
  it('turns every line into cents, both columns, with identifiers taken out', () => {
    const { detail } = extractionFrom(CITY_READING)
    expect(detail.pay.gross).toEqual({
      current: 384_500,
      yearToDate: 8_074_500,
      confidence: 'high',
      source: `Gross Pay 3,845.00 ${REMOVED}`,
    })
    expect(detail.pay.net).toMatchObject({ current: 261_142, yearToDate: null })
    expect(detail.pay.annualSalary).toEqual({
      value: 9_228_000,
      confidence: 'high',
      source: `Annual Salary 92,280.00 ${REMOVED}`,
    })
    expect(detail.pay.hours.value).toBeNull()
    expect(detail.taxes).toMatchObject({
      federalIncome: { current: 35_000, yearToDate: 735_000 },
      stateIncome: { current: 14_988, yearToDate: 314_748 },
      local: { current: 500, yearToDate: null },
      medicare: { current: 5_575 },
      // Not printed stays unknown, never 0.
      socialSecurity: { current: null, yearToDate: null, source: null },
    })
    expect(detail.preTax.pension).toMatchObject({ current: 42_295, yearToDate: 888_195 })
    expect(detail.postTax.roth457).toMatchObject({ current: 5_000 })
    expect(detail.employer.pension).toMatchObject({ current: 82_283, confidence: 'medium' })
    // Nothing that identifies the owner survives anywhere in it.
    expect(JSON.stringify(detail)).not.toMatch(/6789|000123456789|004417|Bannock|80202/)
  })

  it('reads hours and an hourly rate as printed', () => {
    const hourly = cityWith((reading) => {
      reading.pay.hours = readFigure('80.00 + 6.50', 'Regular 80.00 / OT 6.50')
      reading.pay.hourlyRate = readFigure('48.0625', 'Rate 48.0625')
    })
    const { pay } = extractionFrom(hourly).detail
    expect(pay.hours).toMatchObject({ value: 86.5, confidence: 'high' })
    expect(pay.hourlyRate).toMatchObject({ value: 4_806, confidence: 'high' })
  })

  it('marks a printed figure it could not read, or one too large to be real, as low', () => {
    const odd = cityWith((reading) => {
      reading.preTax.hsa = readLine('about 50', '600.00', 'HSA about 50')
      reading.preTax.plan403b = readLine('100,000.01', null, 'TSA 100,000.01')
      reading.preTax.plan401k = readLine('100,000.00', null, '401k 100,000.00')
      reading.pay.net = readLine('2,611.42', '1,000,000.01')
      reading.pay.hours = readFigure('900.00')
    })
    const { detail } = extractionFrom(odd)
    // The readable column is kept; the line is still the one to check.
    expect(detail.preTax.hsa).toMatchObject({
      current: null,
      yearToDate: 60_000,
      confidence: 'low',
    })
    expect(detail.preTax.plan403b).toMatchObject({ current: null, confidence: 'low' })
    // At the limit itself, a figure is kept.
    expect(detail.preTax.plan401k).toMatchObject({ current: 10_000_000, confidence: 'high' })
    expect(detail.pay.net).toMatchObject({ yearToDate: null, confidence: 'low' })
    expect(detail.pay.hours).toMatchObject({ value: null, confidence: 'low' })
  })

  it('flags take-home pay above gross pay for a second look', () => {
    const { detail, current } = extractionFrom(
      cityWith((reading) => {
        reading.pay.net = readLine('3,900.00')
      }),
    )
    expect(detail.pay.gross.confidence).toBe('low')
    expect(detail.pay.net.confidence).toBe('low')
    expect(current.grossPay.confidence).toBe('low')
  })

  it('flags a line whose period amount is above its year to date, as swapped columns are', () => {
    const { detail, current } = extractionFrom(
      cityWith((reading) => {
        reading.pay.gross = readLine('80,745.00', '3,845.00')
        reading.taxes.medicare = readLine('1,170.75', '55.75')
        reading.taxes.federalIncome = readLine('350.00', '350.00')
      }),
    )
    expect(detail.pay.gross).toMatchObject({ current: 8_074_500, confidence: 'low' })
    expect(detail.taxes.medicare.confidence).toBe('low')
    expect(current.grossPay).toMatchObject({ cents: 8_074_500, confidence: 'low' })
    // The year's first paycheck has both columns the same, which is fine.
    expect(detail.taxes.federalIncome.confidence).toBe('high')
  })

  it('never names a support order or garnishment, whichever line the reader filed it under', () => {
    const { detail } = extractionFrom(
      cityWith((reading) => {
        reading.preTax.other = readLine('200.00', null, 'CSE ORDER Jane Doe 200.00')
        reading.taxes.other = readLine('75.00', null, 'AWG 75.00')
        reading.earnings.other = readLine('300.00', null, 'Alimony Jane Doe 300.00')
        reading.employer.match = readLine('20.00', null, 'Support - Jane Doe 20.00')
      }),
    )
    const { preTax, taxes, earnings, employer } = detail
    for (const line of [preTax.other, taxes.other, earnings.other, employer.match]) {
      expect(line).toMatchObject({ current: expect.any(Number), source: null })
    }
    expect(JSON.stringify(detail)).not.toMatch(/Jane|Doe/)
  })

  it('never names an after-tax "other" deduction, whatever its line says', () => {
    const garnished = cityWith((reading) => {
      reading.postTax.other = readLine('150.00', null, 'Garnishment Case 4471 150.00')
    })
    expect(extractionFrom(garnished).detail.postTax.other).toEqual({
      current: 15_000,
      yearToDate: null,
      confidence: 'high',
      source: null,
    })
  })

  it('keeps only real dates', () => {
    const extraction = extractionFrom({
      ...CITY_READING,
      payDate: '11/13/2026',
      periodStart: '2026-02-30',
      periodEnd: null,
    })
    expect(extraction).toMatchObject({ payDate: null, periodStart: null, periodEnd: null })
  })
})

describe('the import figures, worked out from the lines', () => {
  it('matches what the pension and retirement import has always read', () => {
    const extraction = extractionFrom(CITY_READING)
    expect(extraction).toMatchObject({
      employerName: 'City of Example',
      payDate: '2026-11-13',
      payCadence: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
      pensionPlanName: 'PERA',
    })
    expect(extraction.current).toMatchObject({
      grossPay: { cents: 384_500, confidence: 'high', source: `Gross Pay 3,845.00 ${REMOVED}` },
      netPay: { cents: 261_142, source: `Net Pay 2,611.42 Deposit to ${REMOVED}` },
      pension: { cents: 42_295, source: 'PERA Member 11.00% 422.95' },
      pensionEmployer: { cents: 82_283, confidence: 'medium' },
      plan401k: { cents: null, confidence: 'high', source: null },
      hsa: { cents: null },
    })
    expect(extraction.yearToDate).toMatchObject({
      grossPay: { cents: 8_074_500 },
      pension: { cents: 888_195 },
      plan457: { cents: null },
    })
  })

  it("adds a plan's Roth side to its traditional side, as sure as the weaker line", () => {
    const { current } = extractionFrom(
      cityWith((reading) => {
        reading.postTax.roth457 = readLine('50.00', null, 'Roth 457 50.00', 'medium')
      }),
    )
    expect(current.plan457).toEqual({
      cents: 20_000,
      confidence: 'medium',
      source: 'Deferred Comp 457 150.00 + Roth 457 50.00',
    })
  })

  it('gives no figure for a plan, only one to check, when a line of it was printed but dropped', () => {
    const unreadable = extractionFrom(
      cityWith((reading) => {
        reading.preTax.plan457 = readLine('2OO.00', null, '457 Def Comp 2OO.00')
        reading.postTax.roth457 = readLine('100.00')
      }),
    )
    // Adding only the Roth side would save a contribution too low, without a word.
    expect(unreadable.current.plan457).toEqual({
      cents: null,
      confidence: 'low',
      source: '457 Def Comp 2OO.00',
    })
    const tooLarge = extractionFrom(
      cityWith((reading) => {
        reading.preTax.plan457 = readLine('100,000.01')
        reading.postTax.roth457 = readLine('100.00')
      }),
    )
    expect(tooLarge.current.plan457).toMatchObject({ cents: null, confidence: 'low' })
  })

  it('still adds a plan when a line of it is simply not printed in that column', () => {
    const { yearToDate } = extractionFrom(
      cityWith((reading) => {
        reading.preTax.plan457 = readLine('150.00', '3,000.00', 'Deferred Comp 457 150.00')
      }),
    )
    // The Roth line shows this period only; the year column rests on the traditional side.
    expect(yearToDate.plan457).toMatchObject({ cents: 300_000, confidence: 'high' })
    expect(yearToDate.netPay).toEqual({ cents: null, confidence: 'high', source: null })
  })

  it('drops a sum too large to be a contribution and marks it low', () => {
    const { current } = extractionFrom(
      cityWith((reading) => {
        reading.preTax.plan401k = readLine('60,000.00')
        reading.postTax.roth401k = readLine('60,000.00')
      }),
    )
    expect(current.plan401k).toMatchObject({ cents: null, confidence: 'low' })
  })

  it('names no pension plan when the paystub shows no pension contribution', () => {
    const extraction = extractionFrom(
      cityWith((reading) => {
        reading.preTax.pension = readLine(null)
      }),
    )
    expect(extraction.pensionPlanName).toBeNull()
  })
})

describe('foundAnything', () => {
  it('needs a date or at least one figure, from any line or column', () => {
    expect(foundAnything(extractionFrom(CITY_READING))).toBe(true)
    expect(foundAnything(extractionFrom(NOT_A_PAYSTUB))).toBe(false)
    expect(foundAnything(extractionFrom({ ...NOT_A_PAYSTUB, payDate: '2026-11-13' }))).toBe(true)
    const taxOnly = structuredClone(NOT_A_PAYSTUB)
    taxOnly.taxes.medicare = readLine(null, '1,170.75')
    expect(foundAnything(extractionFrom(taxOnly))).toBe(true)
    const rateOnly = structuredClone(NOT_A_PAYSTUB)
    rateOnly.pay.hourlyRate = readFigure('25.00')
    expect(foundAnything(extractionFrom(rateOnly))).toBe(true)
  })
})
