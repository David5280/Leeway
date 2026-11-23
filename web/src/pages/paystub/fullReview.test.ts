import { describe, expect, it } from 'vitest'
import { confirmedDetailSchema } from '../../../../server/src/domain/paystubs/confirmed'
import { cityRead } from '../../test/paystub'
import { fullText, liveDetail, readFull, type FullText } from './fullReview'

const city = () => fullText(cityRead().extraction)

/** The city paystub's text with one change made. */
function edited(change: (text: FullText) => void): FullText {
  const text = structuredClone(city())
  change(text)
  return text
}

describe('fullText', () => {
  it('shows every line Claude read as typed dollars, and a missing one as blank', () => {
    const text = city()
    expect(text).toMatchObject({
      employerName: 'City of Example',
      payDate: '2026-11-13',
      payCadence: 'semimonth',
    })
    expect(text.pay).toMatchObject({
      gross: { current: '3845.00', yearToDate: '80745.00' },
      net: { current: '2611.42', yearToDate: '' },
      hours: '',
      hourlyRate: '',
      annualSalary: '92280.00',
    })
    expect(text.groups.taxes.federalIncome).toEqual({ current: '350.00', yearToDate: '7350.00' })
    expect(text.groups.taxes.socialSecurity).toEqual({ current: '', yearToDate: '' })
    expect(text.groups.postTax.roth457).toEqual({ current: '50.00', yearToDate: '' })
    expect(text.groups.employer.pension.current).toBe('822.83')
  })

  it('shows hours as read, and leaves every detail blank when the paystub showed none', () => {
    const read = cityRead({
      employerName: null,
      payDate: null,
      periodStart: null,
      periodEnd: null,
      payFrequency: { value: null, confidence: 'low', source: null },
    })
    read.extraction.detail.pay.hours = { value: 86.67, confidence: 'high', source: null }
    const text = fullText(read.extraction)
    expect(text).toMatchObject({
      employerName: '',
      payDate: '',
      periodStart: '',
      periodEnd: '',
      payCadence: '',
    })
    expect(text.pay.hours).toBe('86.67')
  })
})

describe('readFull', () => {
  it('reads the review back into the paystub the server takes, unknown lines as null', () => {
    const reviewed = readFull(city())
    if (!reviewed.ok) throw new Error(reviewed.error)
    // The server's own schema takes it as it is.
    expect(confirmedDetailSchema.parse(reviewed.detail)).toEqual(reviewed.detail)
    expect(reviewed.detail.pay).toEqual({
      gross: { current: 384_500, yearToDate: 8_074_500 },
      net: { current: 261_142, yearToDate: null },
      hours: null,
      hourlyRate: null,
      annualSalary: 9_228_000,
    })
    expect(reviewed.detail.taxes.socialSecurity).toEqual({ current: null, yearToDate: null })
    expect(reviewed.detail.preTax.pension).toEqual({ current: 42_295, yearToDate: null })
  })

  it('keeps edits, including a line Claude missed and hours for hourly pay', () => {
    const reviewed = readFull(
      edited((text) => {
        text.groups.taxes.socialSecurity = { current: '238.39', yearToDate: ' 5,006.19 ' }
        text.pay.hours = '80'
        text.pay.hourlyRate = '48.06'
        text.employerName = '  City of Example  '
        text.payCadence = ''
        text.payDate = ''
        text.periodStart = ''
        text.periodEnd = ''
      }),
    )
    if (!reviewed.ok) throw new Error(reviewed.error)
    expect(reviewed.detail.taxes.socialSecurity).toEqual({ current: 23_839, yearToDate: 500_619 })
    expect(reviewed.detail.pay).toMatchObject({ hours: 80, hourlyRate: 4_806 })
    expect(reviewed.detail).toMatchObject({
      employerName: 'City of Example',
      payCadence: null,
      payDate: null,
      periodStart: null,
      periodEnd: null,
    })
  })

  it('names the first figure that is not an amount, by line and column', () => {
    const bad = (change: (text: FullText) => void) => readFull(edited(change))
    expect(
      bad((text) => {
        text.groups.preTax.hsa.yearToDate = 'about 50'
      }),
    ).toEqual({ ok: false, error: 'Enter HSA for the year to date as an amount.' })
    expect(
      bad((text) => {
        text.pay.gross.current = '-3845'
      }),
    ).toEqual({ ok: false, error: 'Enter Gross pay for this paycheck as an amount.' })
    expect(
      bad((text) => {
        text.pay.annualSalary = '92k'
      }),
    ).toEqual({ ok: false, error: 'Enter Yearly salary as an amount.' })
    expect(
      bad((text) => {
        text.pay.hours = '80.125'
      }),
    ).toEqual({ ok: false, error: 'Enter hours as a number, like 80.' })
  })

  it('catches take-home pay above gross pay before it is sent', () => {
    const backwards = edited((text) => {
      text.pay.net.current = '3900'
    })
    expect(readFull(backwards)).toEqual({
      ok: false,
      error: 'Take-home pay cannot be more than gross pay. Check both.',
    })
  })
})

describe('liveDetail', () => {
  it('reads what it can while the owner types, leaving the rest blank', () => {
    const typing = edited((text) => {
      text.pay.gross.current = '38'
      text.groups.taxes.medicare.current = '55.'
      text.pay.hours = 'eig'
    })
    const detail = liveDetail(typing)
    expect(detail.pay.gross.current).toBe(3_800)
    expect(detail.pay.hours).toBeNull()
    expect(detail.taxes.federalIncome.current).toBe(35_000)
  })
})
