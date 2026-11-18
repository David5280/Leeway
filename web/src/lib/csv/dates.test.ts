// Reading dates however a file writes them.

import { describe, expect, it } from 'vitest'
import { guessDateFormat, parseDate, regionDateFormat } from './dates'

describe('reading a date', () => {
  it('reads year-first dates the same in every format', () => {
    for (const format of ['ymd', 'mdy', 'dmy'] as const) {
      expect(parseDate('2026-11-03', format)).toBe('2026-11-03')
      expect(parseDate('2026/1/3', format)).toBe('2026-01-03')
      expect(parseDate('2026.11.03', format)).toBe('2026-11-03')
    }
  })

  it('ignores a time of day after the date', () => {
    expect(parseDate('2026-11-03T14:22:00Z', 'ymd')).toBe('2026-11-03')
    expect(parseDate('11/03/2026 2:22 PM', 'mdy')).toBe('2026-11-03')
  })

  it('reads month-first and day-first dates by the chosen format', () => {
    expect(parseDate('11/03/2026', 'mdy')).toBe('2026-11-03')
    expect(parseDate('11/03/2026', 'dmy')).toBe('2026-03-11')
    expect(parseDate('3-11-2026', 'dmy')).toBe('2026-11-03')
    expect(parseDate('03.11.2026', 'dmy')).toBe('2026-11-03')
  })

  it('reads two-digit years around a 1970 pivot', () => {
    expect(parseDate('1/2/26', 'mdy')).toBe('2026-01-02')
    expect(parseDate('1/2/69', 'mdy')).toBe('2069-01-02')
    expect(parseDate('1/2/70', 'mdy')).toBe('1970-01-02')
    expect(parseDate('1/2/99', 'dmy')).toBe('1999-02-01')
  })

  it('reads dates with the month spelled out, in any format', () => {
    expect(parseDate('3 Nov 2026', 'mdy')).toBe('2026-11-03')
    expect(parseDate('03-Nov-26', 'ymd')).toBe('2026-11-03')
    expect(parseDate('3 November, 2026', 'dmy')).toBe('2026-11-03')
    expect(parseDate('Nov 3, 2026', 'dmy')).toBe('2026-11-03')
    expect(parseDate('September 30 2026', 'mdy')).toBe('2026-09-30')
    expect(parseDate('Sept. 30, 2026', 'mdy')).toBe('2026-09-30')
  })

  it('refuses days that do not exist', () => {
    expect(parseDate('2026-02-29', 'ymd')).toBeNull()
    expect(parseDate('2024-02-29', 'ymd')).toBe('2024-02-29')
    expect(parseDate('13/01/2026', 'mdy')).toBeNull()
    expect(parseDate('00/01/2026', 'mdy')).toBeNull()
    expect(parseDate('2026-04-31', 'ymd')).toBeNull()
    expect(parseDate('31 Foo 2026', 'dmy')).toBeNull()
  })

  it('refuses what is not a date', () => {
    for (const text of ['', 'Pending', '12.50', '1/2', '1/2/123', '20261103', '2026-11-03x']) {
      expect(parseDate(text, 'mdy')).toBeNull()
    }
  })

  it('needs a four-digit year first for the year-first format', () => {
    expect(parseDate('11/03/2026', 'ymd')).toBeNull()
  })
})

describe('guessing the date format', () => {
  it('sees a day past the 12th and picks the format that reads it', () => {
    expect(guessDateFormat(['01/02/2026', '25/02/2026'], 'mdy')).toEqual({
      format: 'dmy',
      ambiguous: false,
    })
    expect(guessDateFormat(['01/02/2026', '02/25/2026'], 'dmy')).toEqual({
      format: 'mdy',
      ambiguous: false,
    })
  })

  it('calls dates no later than the 12th ambiguous and takes the region order', () => {
    expect(guessDateFormat(['01/02/2026', '03/04/2026'], 'mdy')).toEqual({
      format: 'mdy',
      ambiguous: true,
    })
    expect(guessDateFormat(['01/02/2026', '03/04/2026'], 'dmy')).toEqual({
      format: 'dmy',
      ambiguous: true,
    })
  })

  it('is sure of year-first and same-number dates', () => {
    expect(guessDateFormat(['2026-01-02', '2026-03-04'], 'dmy')).toEqual({
      format: 'dmy',
      ambiguous: false,
    })
    expect(guessDateFormat(['01/01/2026', '05/05/2026'], 'mdy').ambiguous).toBe(false)
  })

  it('goes with the format that reads the most when some dates are broken', () => {
    expect(guessDateFormat(['13/01/2026', '14/01/2026', 'soon', ''], 'mdy').format).toBe('dmy')
  })

  it('takes the region order for an empty column', () => {
    expect(guessDateFormat([], 'dmy')).toEqual({ format: 'dmy', ambiguous: false })
  })
})

describe('the region date order', () => {
  it('is month first in the United States and day first elsewhere', () => {
    expect(regionDateFormat('en-US')).toBe('mdy')
    expect(regionDateFormat('en-us')).toBe('mdy')
    expect(regionDateFormat('en-GB')).toBe('dmy')
    expect(regionDateFormat('de-DE')).toBe('dmy')
    expect(regionDateFormat('en')).toBe('dmy')
  })
})
