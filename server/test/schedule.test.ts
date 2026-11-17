import { describe, expect, it } from 'vitest'
import { lastBefore, nextOnOrAfter, occurrences } from '../src/lib/schedule.js'

describe('occurrences', () => {
  it('repeats monthly on the anchor day, clamped in short months', () => {
    expect(occurrences('2026-01-31', 'month', '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('works from an anchor in the future or the distant past', () => {
    expect(occurrences('2027-06-05', 'month', '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-05',
      '2026-12-05',
    ])
    expect(occurrences('2019-03-15', 'quarter', '2026-10-01', '2027-04-01')).toEqual([
      '2026-12-15',
      '2027-03-15',
    ])
  })

  it('steps weekly and biweekly in whole weeks from the anchor, in either direction', () => {
    expect(occurrences('2026-11-20', 'biweek', '2026-10-20', '2026-11-30')).toEqual([
      '2026-10-23',
      '2026-11-06',
      '2026-11-20',
    ])
    expect(occurrences('2026-01-02', 'week', '2026-11-10', '2026-11-24')).toEqual([
      '2026-11-13',
      '2026-11-20',
    ])
  })

  it('alternates the two days of a twice-monthly series', () => {
    expect(occurrences('2026-01-05', 'semimonth', '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-05',
      '2026-11-20',
    ])
  })

  it('includes both ends and returns nothing for an empty range', () => {
    expect(occurrences('2026-01-10', 'year', '2026-01-10', '2027-01-10')).toEqual([
      '2026-01-10',
      '2027-01-10',
    ])
    expect(occurrences('2026-01-10', 'month', '2026-11-11', '2026-12-09')).toEqual([])
  })
})

describe('nextOnOrAfter and lastBefore', () => {
  it('finds the neighbors of a date', () => {
    expect(nextOnOrAfter('2026-01-15', 'month', '2026-11-15')).toBe('2026-11-15')
    expect(nextOnOrAfter('2026-01-15', 'month', '2026-11-16')).toBe('2026-12-15')
    expect(lastBefore('2026-01-15', 'month', '2026-11-15')).toBe('2026-10-15')
    expect(lastBefore('2025-02-01', 'year', '2026-11-17')).toBe('2026-02-01')
  })
})
