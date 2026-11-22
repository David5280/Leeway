// Time zones in a calendar file: which days a moment written on another clock
// covers on the owner's, and the zone math kept quick by remembering offsets.

import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../src/domain/calendar/ics.js'
import { durationMs, momentOf } from '../src/domain/calendar/moments.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

const spans = (events: CalendarEvent[]) => events.map((e) => [e.startsOn, e.endsOn])

describe('time zones', () => {
  it('reads a TZID on its own clock, moved to the owner’s day', () => {
    const text = ics([
      'UID:tokyo',
      'SUMMARY:Flight home',
      'DTSTART;TZID=Asia/Tokyo:20261129T080000',
      'DTEND;TZID=America/Denver:20261128T060000',
    ])
    expect(
      spans(eventsIn(text, 'America/Denver', { from: '2026-11-01', to: '2026-12-31' })),
    ).toEqual([['2026-11-28', '2026-11-28']])
  })

  it('ends a UTC end landing on the owner’s midnight on the day before', () => {
    const text = ics([
      'UID:x',
      'SUMMARY:Party weekend',
      'DTSTART:20261212T030000Z',
      'DTEND:20261213T070000Z',
    ])
    // 8 PM on Dec 11 to midnight Dec 13, Denver time.
    expect(
      spans(eventsIn(text, 'America/Denver', { from: '2026-12-01', to: '2026-12-31' })),
    ).toEqual([['2026-12-11', '2026-12-12']])
  })

  it('counts the hours of a timed duration, so a red-eye ends the next day', () => {
    const text = ics(
      ['UID:a', 'SUMMARY:Red-eye', 'DTSTART:20261212T220000', 'DURATION:PT6H'],
      [
        'UID:b',
        'SUMMARY:Red-eye',
        'DTSTART;TZID=America/Denver:20261212T220000',
        'DURATION:PT6H30M',
      ],
      [
        'UID:c',
        'SUMMARY:Short',
        'DTSTART;TZID=America/Denver:20261212T220000',
        'DURATION:PT1H59M59S',
      ],
    )
    expect(
      spans(eventsIn(text, 'America/Denver', { from: '2026-12-01', to: '2026-12-31' })),
    ).toEqual([
      ['2026-12-12', '2026-12-13'],
      ['2026-12-12', '2026-12-13'],
      ['2026-12-12', '2026-12-12'],
    ])
  })

  it('reads a zone Intl does not know as floating, on the owner’s own clock', () => {
    expect(momentOf('20261212T220000', 'Eastern Standard Time')).toEqual({
      date: '2026-12-12',
      seconds: 79200,
      zone: null,
    })
    expect(momentOf('20261212T220000Z', 'Asia/Tokyo')?.zone).toBe('UTC')
    expect(momentOf('20261212T220000', 'Asia/Tokyo')?.zone).toBe('Asia/Tokyo')
    expect(momentOf('20261212')).toEqual({ date: '2026-12-12', seconds: null, zone: null })
    expect(momentOf('Dec 12')).toBeNull()
    expect(momentOf(undefined)).toBeNull()
  })

  it('reads durations of weeks, days and clock time, and nothing from a broken one', () => {
    expect(durationMs('P1W')).toBe(7 * 86_400_000)
    expect(durationMs('P1DT2H3M4S')).toBe(86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4000)
    expect(durationMs('-P1D')).toBe(0)
    expect(durationMs(undefined)).toBe(0)
  })
})
