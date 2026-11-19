import { describe, expect, it } from 'vitest'
import { merchantKey, textKey } from '../src/domain/merchantKey.js'
import { detectRecurring, type PastTransaction } from '../src/domain/recurring.js'

/** No accounts with masks: names are only cleaned (see safeName.ts). */
const NO_MASKS: string[] = []

const TODAY = '2026-11-17'

/** One charge per date, with an optional amount per date. */
function charges(
  name: string,
  dates: string[],
  amountCents: number | number[],
  categoryId: string | null = null,
): PastTransaction[] {
  return dates.map((date, i) => ({
    date,
    merchantName: name,
    name: name.toUpperCase(),
    amountCents: Array.isArray(amountCents) ? amountCents[i]! : amountCents,
    categoryId,
  }))
}

describe('merchantKey', () => {
  it('drops store numbers, card digits and punctuation', () => {
    expect(merchantKey({ merchantName: null, name: 'NETFLIX.COM 8473 CA' })).toBe('netflix com ca')
    expect(merchantKey({ merchantName: null, name: 'Netflix.com #1192 CA' })).toBe('netflix com ca')
  })

  it('prefers the merchant name over the bank description', () => {
    expect(merchantKey({ merchantName: 'Spotify', name: 'SPOTIFY P1A2B3' })).toBe('spotify')
  })

  it('reduces any text the same way, as a bill pattern is read', () => {
    expect(textKey('  Netflix.com #1192 ')).toBe('netflix com')
    expect(textKey('1234')).toBe('')
  })
})

describe('detectRecurring', () => {
  it('finds a fixed monthly charge and reads it as a subscription', () => {
    const found = detectRecurring(
      charges('Netflix', ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'], 1549, 'fun'),
      TODAY,
      NO_MASKS,
    )
    expect(found).toEqual([
      {
        key: 'netflix',
        name: 'Netflix',
        direction: 'out',
        cadence: 'month',
        typicalAmountCents: 1549,
        amountVaries: false,
        count: 4,
        lastDate: '2026-11-03',
        nextDate: '2026-12-03',
        categoryId: 'fun',
        suggestedKind: 'subscription',
      },
    ])
  })

  it('reads a monthly charge whose amount changes as a bill', () => {
    const [power] = detectRecurring(
      charges('Xcel Energy', ['2026-08-20', '2026-09-19', '2026-10-21'], [8812, 10240, 7655]),
      TODAY,
      NO_MASKS,
    )
    expect(power).toMatchObject({
      cadence: 'month',
      amountVaries: true,
      typicalAmountCents: 8812,
      suggestedKind: 'bill',
      nextDate: '2026-11-21',
    })
  })

  it('finds biweekly paychecks as money in', () => {
    const pay = charges(
      'Acme Payroll',
      ['2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06'],
      -250000,
    )
    expect(detectRecurring(pay, TODAY, NO_MASKS)).toMatchObject([
      { direction: 'in', cadence: 'biweek', typicalAmountCents: 250000, nextDate: '2026-11-20' },
    ])
  })

  it('finds weekly, quarterly and yearly series, but not a single charge', () => {
    const found = detectRecurring(
      [
        ...charges('Gym', ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'], 1500),
        ...charges('Car insurance', ['2026-02-15', '2026-05-15', '2026-08-15'], 31200),
        ...charges('Amazon Prime', ['2024-11-20', '2025-11-20'], 13900),
        ...charges('Domain renewal', ['2025-12-01'], 1800),
      ],
      TODAY,
      NO_MASKS,
    )
    // Soonest first: insurance was expected two days ago and has not posted yet.
    expect(found.map((s) => [s.name, s.cadence, s.nextDate])).toEqual([
      ['Car insurance', 'quarter', '2026-11-15'],
      ['Amazon Prime', 'year', '2026-11-20'],
      ['Gym', 'week', '2026-11-20'],
    ])
  })

  it('tolerates one skipped month among regular ones', () => {
    const dates = [
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
    ]
    expect(detectRecurring(charges('Hulu', dates, 1299), '2026-10-20', NO_MASKS)).toHaveLength(1)
  })

  it('ignores a series that has stopped', () => {
    const dates = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']
    expect(detectRecurring(charges('Old gym', dates, 4000), TODAY, NO_MASKS)).toEqual([])
  })

  it('ignores spending that is frequent but not regular', () => {
    const dates = ['2026-10-01', '2026-10-04', '2026-10-15', '2026-10-17', '2026-11-09']
    expect(detectRecurring(charges('Coffee shop', dates, 550), TODAY, NO_MASKS)).toEqual([])
  })

  it('needs more than two charges for a monthly series', () => {
    expect(
      detectRecurring(charges('Trial', ['2026-10-01', '2026-11-01'], 999), TODAY, NO_MASKS),
    ).toEqual([])
  })

  it('counts two charges on one day as one, and keeps refunds out of the series', () => {
    const found = detectRecurring(
      [
        ...charges(
          'Phone',
          ['2026-08-12', '2026-09-12', '2026-09-12', '2026-10-12', '2026-11-12'],
          6000,
        ),
        ...charges('Phone', ['2026-09-14'], -6000),
      ],
      TODAY,
      NO_MASKS,
    )
    expect(found).toMatchObject([{ direction: 'out', count: 4 }])
  })

  it('skips charges with no usable name or no amount, and files by the usual category', () => {
    const found = detectRecurring(
      [
        ...charges('1234', ['2026-08-03', '2026-09-03', '2026-10-03'], 500),
        ...charges('Zero', ['2026-08-03', '2026-09-03', '2026-10-03'], 0),
        ...charges('Gas', ['2026-08-10', '2026-09-10'], 3000, 'auto'),
        ...charges('Gas', ['2026-10-10'], 3000, 'travel'),
      ],
      TODAY,
      NO_MASKS,
    )
    expect(found.map((s) => [s.name, s.categoryId])).toEqual([['Gas', 'auto']])
  })

  it('lists the soonest expected first', () => {
    const found = detectRecurring(
      [
        ...charges('Late', ['2026-08-28', '2026-09-28', '2026-10-28'], 1000),
        ...charges('Early', ['2026-08-20', '2026-09-20', '2026-10-20'], 1000),
      ],
      TODAY,
      NO_MASKS,
    )
    expect(found.map((s) => s.name)).toEqual(['Early', 'Late'])
  })
})
