// Calendar files grown big, by many events or by one event listing the same
// thing thousands of times: each still reads well under a second.

import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../src/domain/calendar/ics.js'
import { LIKELY_TO_COST } from '../src/domain/calendar/reading.js'
import { REPEAT_UNITS, workBudget } from '../src/domain/calendar/recurrence.js'
import { eventsIn, ics, icsDay, QUICK_MS, timed } from './fixtures/calendarFile.js'

describe('a large ordinary calendar', () => {
  const window = { from: '2023-11-21', to: '2027-11-23' }

  it('reads 8,000 meetings on a named zone’s clock well under a second, keeping none', () => {
    // Ten years of hour-long meetings as Google exports them: about 1.7MB.
    const meetings = Array.from({ length: 8000 }, (_, i) => [
      `UID:m${i}@google.com`,
      `DTSTART;TZID=America/Denver:${icsDay(Math.floor(i * 0.45))}T100000`,
      `DTEND;TZID=America/Denver:${icsDay(Math.floor(i * 0.45))}T110000`,
      `SUMMARY:Meeting ${i % 50}`,
      'LOCATION:Office',
    ])
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(ics(...meetings), 'America/Denver', window, { keep: LIKELY_TO_COST })
    })
    expect(events).toEqual([])
    expect(ms).toBeLessThan(QUICK_MS)
  })

  it('reads 10,000 trips on a named zone’s clock in under a second', () => {
    const trips = Array.from({ length: 10_000 }, (_, i) => [
      `UID:t${i}`,
      `SUMMARY:Trip ${i}`,
      `DTSTART;TZID=Asia/Tokyo:${icsDay(2900 + (i % 400))}T100000`,
      `DTEND;TZID=Asia/Tokyo:${icsDay(2902 + (i % 400))}T100000`,
    ])
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(ics(...trips), 'America/Denver', window, { keep: LIKELY_TO_COST })
    })
    expect(events.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(QUICK_MS)
  })

  it('pays for each repeat of a timed event on a named zone’s clock from the budget', () => {
    // Fifty daily trips at 9 AM in New York: each repeat's time zone math is work too.
    const daily = Array.from({ length: 50 }, (_, i) => [
      `UID:d${i}`,
      `SUMMARY:Trip ${i}`,
      'DTSTART;TZID=America/New_York:20200101T090000',
      'DTEND;TZID=America/New_York:20200101T100000',
      'RRULE:FREQ=DAILY',
    ])
    const budget = workBudget()
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(ics(...daily), 'America/Denver', window, { budget })
    })
    expect(ms).toBeLessThan(QUICK_MS)
    expect(budget.ranOut).toBe(true)
    expect(budget.unitsLeft).toBeGreaterThanOrEqual(0)
    // About 1,500 repeats across the window at a dozen units each: a few rules fit, not all.
    const kept = new Set(events.map((event) => event.uid))
    expect(kept.size).toBeGreaterThan(1)
    expect(kept.size).toBeLessThan(50)
    expect(REPEAT_UNITS.zoned).toBeGreaterThan(REPEAT_UNITS.plain)
  })
})

describe('a file listing the same thing thousands of times', () => {
  const window = { from: '2023-11-21', to: '2027-11-23' }
  const daily = [
    'UID:x',
    'SUMMARY:Camping trip',
    'DTSTART;TZID=America/New_York:20240101T090000',
    'RRULE:FREQ=DAILY;COUNT=40',
  ]

  it('reads 110,000 EXDATE values on the event’s own clock in a moment, and still skips them', () => {
    // Every day of 2024's first four weeks, each listed thousands of times over.
    const values = Array.from(
      { length: 110_000 },
      (_, i) => `202401${String(1 + (i % 28)).padStart(2, '0')}T090000`,
    )
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(
        ics([...daily, `EXDATE;TZID=America/New_York:${values.join(',')}`]),
        'UTC',
        window,
      )
    })
    expect(ms).toBeLessThan(QUICK_MS)
    expect(events.map((event) => event.startsOn)).toEqual([
      '2024-01-29',
      '2024-01-30',
      '2024-01-31',
      '2024-02-01',
      '2024-02-02',
      '2024-02-03',
      '2024-02-04',
      '2024-02-05',
      '2024-02-06',
      '2024-02-07',
      '2024-02-08',
      '2024-02-09',
    ])
  })

  it('pays for EXDATEs on another clock from the budget, leaving out an event that lists too many', () => {
    // 60,000 different moments in UTC, each needing time zone math to place.
    const values = Array.from({ length: 60_000 }, (_, i) => {
      const day = icsDay(2930 + (i % 1400))
      return `${day}T${String(Math.floor(i / 1400) % 24).padStart(2, '0')}${String(i % 60).padStart(2, '0')}00Z`
    })
    const text = ics(
      [...daily, `EXDATE:${values.join(',')}`],
      ['UID:mom', "SUMMARY:Mom's birthday", 'DTSTART;VALUE=DATE:19600305', 'RRULE:FREQ=YEARLY'],
    )
    const budget = workBudget()
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(text, 'UTC', window, { budget })
    })
    expect(ms).toBeLessThan(QUICK_MS)
    expect(budget.ranOut).toBe(true)
    // Left out before any was placed, so the birthday still has nearly all the budget to draw on.
    expect(budget.unitsLeft).toBeGreaterThan(190_000)
    expect(new Set(events.map((event) => event.uid))).toEqual(new Set(['mom']))
  })

  it('reads 36,000 changed repeats of one event in a moment', () => {
    const changed = Array.from({ length: 36_000 }, (_, i) => [
      'UID:r',
      `RECURRENCE-ID;VALUE=DATE:202401${String(1 + (i % 28)).padStart(2, '0')}`,
    ])
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(
        ics(
          ['UID:r', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20240101', 'RRULE:FREQ=DAILY;COUNT=30'],
          ...changed,
        ),
        'UTC',
        window,
      )
    })
    expect(ms).toBeLessThan(QUICK_MS)
    // Each of the first 28 days is replaced by a repeat with no start, which replaces it with nothing.
    expect(events.map((event) => event.startsOn)).toEqual(['2024-01-29', '2024-01-30'])
  })

  it.each([
    ['BYDAY', 'FREQ=MONTHLY;BYDAY=', 'MO'],
    ['BYMONTHDAY', 'FREQ=MONTHLY;BYMONTHDAY=', '1'],
    ['BYMONTH', 'FREQ=YEARLY;BYMONTHDAY=1;BYMONTH=', '1'],
  ])('reads a %s list of 200,000 repeated entries in a moment', (_, start, entry) => {
    const rule = `${start}${Array.from({ length: 200_000 }, () => entry).join(',')}`
    const text = ics(['UID:h', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20240101', `RRULE:${rule}`])
    let events: CalendarEvent[] = []
    const ms = timed(() => {
      events = eventsIn(text, 'UTC', window)
    })
    expect(ms).toBeLessThan(QUICK_MS)
    expect(events.length).toBeGreaterThan(0)
  })
})

describe('a file naming zones thousands of ways', () => {
  const window = { from: '2023-11-21', to: '2027-11-23' }
  /** A file this big reads in about half a second here; twice QUICK_MS leaves CI room. */
  const BIG_FILE_MS = 2 * QUICK_MS
  /** `name` with its letters' case set by the bits of `i`, so each spelling is new. */
  const spelled = (name: string, i: number) =>
    [...name]
      .map((letter, j) => ((i >> (j % 20)) & 1 ? letter.toUpperCase() : letter.toLowerCase()))
      .join('')
  /** How long reading these events takes, and what it kept. */
  const read = (events: string[][]) => {
    let kept: CalendarEvent[] = []
    const ms = timed(() => {
      kept = eventsIn(ics(...events), 'America/Denver', window, { keep: LIKELY_TO_COST })
    })
    return { ms, kept }
  }

  it('reads 16,500 events, each spelling a zone its own way, well under two seconds', () => {
    // A link Intl does not list, so each spelling would be a new name to look up.
    const { ms, kept } = read(
      Array.from({ length: 16_500 }, (_, i) => [
        `UID:${i}`,
        'SUMMARY:Trip',
        `DTSTART;TZID=${spelled('America/Argentina/ComodRivadavia', i)}:20260101T100000`,
      ]),
    )
    expect(ms).toBeLessThan(BIG_FILE_MS)
    expect(kept.length).toBeGreaterThan(0)
  })

  it('reads 16,000 events cycling through every zone Intl lists well under two seconds', () => {
    // Hundreds of zones in turn, each on its own days: no cache may run out and start again.
    const zones = Intl.supportedValuesOf('timeZone')
    const { ms, kept } = read(
      Array.from({ length: 16_000 }, (_, i) => [
        `UID:${i}`,
        'SUMMARY:Trip',
        `DTSTART;TZID=${zones[i % zones.length]}:${icsDay(2900 + ((i * 7) % 1400))}T100000`,
      ]),
    )
    expect(zones.length).toBeGreaterThan(400)
    expect(ms).toBeLessThan(BIG_FILE_MS)
    expect(kept.length).toBeGreaterThan(0)
  })

  it('reads 20,000 made-up zones well under two seconds, as floating', () => {
    const { ms, kept } = read(
      Array.from({ length: 20_000 }, (_, i) => [
        `UID:${i}`,
        'SUMMARY:Trip',
        `DTSTART;TZID=Made/Up${i}:20260101T230000`,
      ]),
    )
    expect(ms).toBeLessThan(BIG_FILE_MS)
    // 11 PM floating stays on the day written.
    expect(new Set(kept.map((event) => event.startsOn))).toEqual(new Set(['2026-01-01']))
  })

  it('reads 15,000 EXDATE zones, each spelled its own way, well under two seconds', () => {
    const { ms, kept } = read(
      Array.from({ length: 15_000 }, (_, i) => [
        `UID:${i}`,
        'SUMMARY:Trip',
        'DTSTART;TZID=America/Denver:20260101T100000',
        'RRULE:FREQ=DAILY;COUNT=2',
        `EXDATE;TZID=${spelled('America/Denver', i)}:20260102T100000`,
      ]),
    )
    expect(ms).toBeLessThan(BIG_FILE_MS)
    // Every EXDATE is read as Denver's, so each event keeps only its first day.
    expect(new Set(kept.map((event) => event.startsOn))).toEqual(new Set(['2026-01-01']))
  })
})
