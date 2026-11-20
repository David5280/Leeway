// The drill-down behind the savings rate: the usual month, the finished
// months' rates as the math with the middle picked, and each month.

import { describe, expect, it } from 'vitest'
import { mathSentence } from '../drill'
import { formatMoney } from '../money'
import type { MonthRate } from '../rates'
import { savingsRateDrill } from './rates'

const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })
const label = (iso: string) => iso.slice(0, 7)

const rate = (start: string, percent: number | null, current = false): MonthRate => ({
  start,
  current,
  percent,
  savedCents: percent === null ? 0 : percent * 4000,
  payCents: percent === null ? 0 : 400000,
})

const drillOf = (months: MonthRate[], targetPercent: number | null = null) =>
  savingsRateDrill({ months, targetPercent, note: 'Counts transfers.' }, label, money)

describe('savingsRateDrill', () => {
  it('answers with the usual month, halfway between two middles, and lists each month', () => {
    const drill = drillOf(
      [
        rate('2026-08-01', 9),
        rate('2026-09-01', null),
        rate('2026-10-01', 20),
        rate('2026-11-01', 5, true),
      ],
      15,
    )
    expect(drill.subtitle).toBe('A usual month: the middle of the last 2 finished months')
    expect(drill.figure).toEqual({ text: '15%' })
    expect(mathSentence(drill.math, money)).toBe(
      'Usual month, halfway between the two 15% = 2026-08, the middle 9% and 2026-10, the middle 20%',
    )
    expect(drill.math.note).toBe(
      'Counts transfers. The usual month is the middle one, so one big month does not set it.',
    )
    expect(drill.items!.rows.map((row) => [row.label, row.detail, row.value])).toEqual([
      ['2026-11, so far', '$200 of $4,000', { text: '5%', tone: undefined }],
      ['2026-10', '$800 of $4,000', { text: '20%', tone: 'in' }],
      ['2026-09', 'No pay or saving seen', { text: 'Not known', tone: undefined }],
      ['2026-08', '$360 of $4,000', { text: '9%', tone: undefined }],
    ])
    expect(drill.more).toEqual({ to: '/plan/retirement', label: 'Add money taken from pay' })
  })

  it('lists an odd count lowest first and picks the one middle month, the figure it shows', () => {
    const drill = drillOf([
      rate('2026-08-01', 30),
      rate('2026-09-01', 9),
      rate('2026-10-01', 12),
      rate('2026-11-01', 50, true),
    ])
    expect(drill.figure).toEqual({ text: '12%' })
    expect(mathSentence(drill.math, money)).toBe(
      'Usual month 12% = 2026-09 9% and 2026-10, the middle 12% and 2026-08 30%',
    )
    expect(drill.math.result.value).toEqual(drill.figure)
  })

  it('says so when no month has finished, leaving the running month to the list', () => {
    const running = drillOf([rate('2026-11-01', 5, true)])
    expect(running.subtitle).toBe('No finished month with a rate yet')
    expect(running.figure).toEqual({ text: 'Not known yet' })
    expect(mathSentence(running.math, money)).toBe(
      'Usual month Not known yet = Finished months None yet',
    )
    expect(running.items!.rows[0]!.value).toEqual({ text: '5%', tone: undefined })
    expect(drillOf([rate('2026-10-01', 12)]).subtitle).toBe(
      'A usual month: the one finished month so far',
    )
  })
})
