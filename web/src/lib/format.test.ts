import { describe, expect, it } from 'vitest'
import {
  calendarDate,
  dayLabel,
  isUnreadableRate,
  MAX_RATE_PERCENT,
  parseMoney,
  parseRate,
  readRate,
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
    expect(parseMoney('-12.50')).toBe(-1250)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('refuses a typed number with a letter inside it, never reading round it', () => {
    // Dropping the letter would read "5e1" as 51 and "1O0" as 10.
    for (const text of ['5e1', '1O0', '12e3', 'abc']) {
      expect(parseMoney(text)).toBeNull()
      expect(readRate(text)).toBeNull()
    }
    // A currency or percent sign is no letter.
    expect(parseMoney('\u20ac12,50')).toBe(1250)
    expect(readRate('5%')).toBe(5)
  })

  it('reads an amount with a currency written in letters before or after it', () => {
    expect(parseMoney('R$ 12,50')).toBe(1250)
    expect(parseMoney('CHF 12.50')).toBe(1250)
    expect(parseMoney('12 USD')).toBe(1200)
    expect(parseMoney('USD1,200')).toBe(120000)
    expect(parseMoney('120kr')).toBe(12000)
    // A rate takes no currency, so letters there still refuse it.
    expect(readRate('12 USD')).toBeNull()
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

// Reading a typed interest rate, shared by a debt's terms on Plan, Debts and
// the APR prompt on a card's page.
describe('parseRate', () => {
  it('reads a dot decimal, with or without a percent sign, to the hundredth', () => {
    expect(parseRate('24.99')).toBe(24.99)
    expect(parseRate(' 19.5% ')).toBe(19.5)
    expect(parseRate('0')).toBe(0)
    expect(parseRate('7.125')).toBe(7.13)
    expect(parseRate('19.999%')).toBe(20)
  })

  it('reads a comma decimal as many locales type it, never as more digits', () => {
    expect(parseRate('7,5')).toBe(7.5)
    expect(parseRate('9,9')).toBe(9.9)
    expect(parseRate('24,99')).toBe(24.99)
    expect(parseRate('24,99 %')).toBe(24.99)
  })

  it(`refuses a rate over ${MAX_RATE_PERCENT}%, which no card or loan charges`, () => {
    expect(parseRate('100')).toBe(100)
    expect(parseRate('100.01')).toBeNull()
    expect(parseRate('150')).toBeNull()
    // A comma before three digits groups thousands, so this is 1,000, not 1.
    expect(parseRate('1,000')).toBeNull()
  })

  it('is null when blank or not a number', () => {
    expect(parseRate('')).toBeNull()
    expect(parseRate('   ')).toBeNull()
    expect(parseRate('APR')).toBeNull()
    expect(parseRate('%')).toBeNull()
    expect(parseRate('.')).toBeNull()
    expect(parseRate('1.2.3')).toBeNull()
  })

  it('refuses a negative rate rather than turning it positive', () => {
    expect(parseRate('-5')).toBeNull()
    // The true minus sign too, as a phone keyboard may type it.
    expect(parseRate('\u22125')).toBeNull()
  })
})

describe('readRate', () => {
  it('reads a rate as parseRate does, but over 100% too, for a form that explains it', () => {
    expect(readRate('24,99')).toBe(24.99)
    expect(readRate('150')).toBe(150)
    expect(readRate('-5')).toBeNull()
    expect(readRate('APR')).toBeNull()
  })
})

describe('isUnreadableRate', () => {
  it('is true for a rate typed that cannot be read', () => {
    for (const text of ['-5', '\u22125', 'APR', 'six']) expect(isUnreadableRate(text)).toBe(true)
  })

  it('is false for a blank field, which clears the rate on purpose, and any readable rate', () => {
    for (const text of ['', '  ', '6.5', '19.5%', '0', '7,5', '150']) {
      expect(isUnreadableRate(text)).toBe(false)
    }
  })
})
