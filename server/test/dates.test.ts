import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dateParts,
  dayOfWeek,
  daysBetween,
  fromDayNumber,
  isIsoDate,
  isValidTimeZone,
  maxDate,
  minDate,
  todayIn,
  toDayNumber,
} from '../src/lib/dates.js'

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-1-01')).toBe(false)
  })

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('clamps months to their length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-11-17')).toBe(2) // a Tuesday
    expect(dayOfWeek('1970-01-01')).toBe(4)
  })

  it('reads today in the owner time zone, not UTC', () => {
    // 2 AM UTC on the 18th is still the evening of the 17th in Denver.
    const now = new Date('2026-11-18T02:00:00Z')
    expect(todayIn('UTC', now)).toBe('2026-11-18')
    expect(todayIn('America/Denver', now)).toBe('2026-11-17')
  })

  it('reads today from the clock when no time is given', () => {
    expect(isIsoDate(todayIn('UTC'))).toBe(true)
  })

  it('refuses to do math on a date that does not exist', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow('Not a valid date: 2026-02-30')
    expect(() => dateParts('soon')).toThrow('Not a valid date: soon')
  })

  it('knows real time zones from made-up ones', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })

  it('picks the earlier and the later of two dates', () => {
    expect(minDate('2026-11-17', '2026-01-02')).toBe('2026-01-02')
    expect(minDate('2026-01-02', '2026-11-17')).toBe('2026-01-02')
    expect(maxDate('2026-11-17', '2026-01-02')).toBe('2026-11-17')
    expect(maxDate('2026-01-02', '2026-11-17')).toBe('2026-11-17')
  })
})

describe('remembered day numbers', () => {
  it('stays right across more days than it remembers at once', () => {
    // 50,000 days both ways, past the 20,000 each map holds before it is emptied.
    for (let day = -20_000; day < 30_000; day++) {
      const date = new Date(day * 86_400_000).toISOString().slice(0, 10)
      expect(toDayNumber(date)).toBe(day)
      expect(fromDayNumber(day)).toBe(date)
    }
    // A date that is not one is refused every time, never remembered.
    expect(() => toDayNumber('2026-02-30')).toThrow()
    expect(() => toDayNumber('2026-02-30')).toThrow()
  })
})
