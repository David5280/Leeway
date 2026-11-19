import { describe, expect, it } from 'vitest'
import {
  calendarDate,
  dayLabel,
  parseMoney,
  periodBarLabel,
  periodLabel,
  periodWord,
  relativeDay,
  timeAgo,
} from './format'

describe('format', () => {
  it('reads typed amounts into cents', () => {
    expect(parseMoney('12.50')).toBe(1250)
    expect(parseMoney('$1,200')).toBe(120000)
    expect(parseMoney('1200')).toBe(120000)
    expect(parseMoney('12,5')).toBe(1250)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('names periods plainly', () => {
    expect(periodLabel('2026-11-01', '2026-11-30')).toBe('November 2026')
    expect(periodLabel('2026-11-14', '2026-11-27')).toBe('Nov 14 to Nov 27')
    expect(dayLabel('2026-11-17')).toBe('Tue, Nov 17')
  })

  it('says how long ago', () => {
    const now = Date.parse('2026-11-17T12:00:00Z')
    expect(timeAgo(null)).toBe('never')
    expect(timeAgo('2026-11-17T11:50:00Z', now)).toBe('10 min ago')
    expect(timeAgo('2026-11-17T09:00:00Z', now)).toBe('3 h ago')
    expect(timeAgo('2026-11-17T11:59:50Z', now)).toBe('just now')
    expect(timeAgo('2026-11-02T12:00:00Z', now)).toBe('Nov 2')
  })

  it('gives the calendar day of a timestamp, with the year only when it is not this one', () => {
    const now = new Date('2026-11-17T12:00:00Z')
    expect(calendarDate('2026-03-04T12:00:00Z', now)).toBe('Mar 4')
    expect(calendarDate('2025-03-04T12:00:00Z', now)).toBe('Mar 4, 2025')
  })

  it('names a period kind in everyday words', () => {
    expect(periodWord('monthly')).toBe('month')
    expect(periodWord('weekly')).toBe('week')
    expect(periodWord('paycheck')).toBe('paycheck')
  })

  it('labels chart bars by month for monthly budgets and by start day otherwise', () => {
    expect(periodBarLabel('2026-11-01', 'monthly')).toBe('Nov')
    expect(periodBarLabel('2026-11-14', 'paycheck')).toBe('Nov 14')
  })

  it('says today, yesterday and tomorrow, and the date otherwise, with the year when it differs', () => {
    const today = '2026-11-19'
    expect(relativeDay('2026-11-19', today)).toBe('Today')
    expect(relativeDay('2026-11-18', today)).toBe('Yesterday')
    expect(relativeDay('2026-11-20', today)).toBe('Tomorrow')
    expect(relativeDay('2026-11-13', today)).toBe('Fri, Nov 13')
    expect(relativeDay('2025-12-31', today)).toBe('Wed, Dec 31, 2025')
  })
})
