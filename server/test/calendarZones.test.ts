// Time zones in a calendar file: which days a moment written on another clock
// covers on the owner's, and how a file's zone names are read to Intl's.

import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../src/domain/calendar/ics.js'
import { durationMs, momentOf } from '../src/domain/calendar/moments.js'
import { listedZone, MAX_ZONE_LOOKUPS, zoneReader } from '../src/domain/calendar/zoneNames.js'
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

describe('zone names', () => {
  const window = { from: '2026-11-01', to: '2026-12-31' }
  /** The days an 8 AM event on Dec 12, written in `tzid`, covers in Denver. */
  const daysIn = (tzid: string) =>
    spans(
      eventsIn(
        ics(['UID:z', 'SUMMARY:Trip', `DTSTART;TZID=${tzid}:20261212T080000`]),
        'America/Denver',
        window,
      ),
    )

  it('reads a zone in any case, and a link to one, as the zone itself', () => {
    // 8 AM in Tokyo or in India is still the 11th in Denver.
    expect(daysIn('Asia/Tokyo')).toEqual([['2026-12-11', '2026-12-11']])
    expect(daysIn('asia/TOKYO')).toEqual([['2026-12-11', '2026-12-11']])
    expect(daysIn('asia/kolkata')).toEqual([['2026-12-11', '2026-12-11']])
    // A name Intl cannot place reads as floating: 8 AM on Denver's own clock.
    expect(daysIn('Eastern Standard Time')).toEqual([['2026-12-12', '2026-12-12']])
  })

  it('knows every zone Intl lists without asking it, in any case', () => {
    expect(listedZone('america/denver')).toBe('America/Denver')
    expect(listedZone(' UTC ')).toBe('UTC')
    expect(listedZone('US/Eastern')).toBeNull()
    expect(listedZone('Bogus/Zone')).toBeNull()
  })

  it('looks up names Intl does not list a bounded number of times per file', () => {
    const read = zoneReader()
    expect(read('US/Eastern')).toBe('America/New_York')
    expect(read('Etc/UTC')).toBe('UTC')
    expect(read('Bogus/Zone')).toBeNull()
    for (let i = 0; i < MAX_ZONE_LOOKUPS; i++) read(`Made/Up${i}`)
    // Past the bound a link reads as floating, yet a listed zone is still known.
    expect(read('US/Pacific')).toBeNull()
    expect(read('EUROPE/rome')).toBe('Europe/Rome')
    // Each file starts afresh.
    expect(zoneReader()('US/Pacific')).toBe('America/Los_Angeles')
  })
})
