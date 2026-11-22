import { describe, expect, it } from 'vitest'
import { MAX_EVENTS, parseCalendar } from '../src/domain/calendar/ics.js'
import { daysOf, kindOf } from '../src/domain/calendar/kinds.js'
import { mergeSpans, type KindedEvent } from '../src/domain/calendar/spans.js'

const WINDOW = { from: '2026-01-01', to: '2027-12-31' }

/** A calendar file holding these events, each given as its lines. */
function ics(...events: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')
}

describe('parseCalendar', () => {
  it('reads all-day events, with their end day exclusive as the format says', () => {
    const text = ics([
      'UID:trip-1',
      'SUMMARY:Lisbon trip',
      'LOCATION:Lisbon\\, Portugal',
      'DTSTART;VALUE=DATE:20261210',
      'DTEND;VALUE=DATE:20261215',
    ])
    expect(parseCalendar(text, 'UTC', WINDOW)).toEqual([
      {
        uid: 'trip-1',
        startsOn: '2026-12-10',
        endsOn: '2026-12-14',
        title: 'Lisbon trip',
        location: 'Lisbon, Portugal',
        allDay: true,
      },
    ])
  })

  it('moves a UTC moment into the owner’s day, and keeps a local one as written', () => {
    const text = ics(
      [
        'UID:late',
        'SUMMARY:Flight to Denver',
        'DTSTART:20261211T030000Z',
        'DTEND:20261211T060000Z',
      ],
      ['UID:local', 'SUMMARY:Concert', 'DTSTART;TZID=America/Chicago:20261212T200000'],
    )
    const events = parseCalendar(text, 'America/New_York', WINDOW)
    // 3 AM UTC is still the evening before in New York.
    expect(events.map((e) => [e.uid, e.startsOn, e.endsOn, e.allDay])).toEqual([
      ['late', '2026-12-10', '2026-12-11', false],
      ['local', '2026-12-12', '2026-12-12', false],
    ])
  })

  it('ends a timed event at midnight on the day before, and never before it starts', () => {
    const text = ics(
      ['UID:a', 'SUMMARY:Party', 'DTSTART:20261212T200000', 'DTEND:20261213T000000'],
      ['UID:b', 'SUMMARY:Odd', 'DTSTART:20261212T200000', 'DTEND:20261210T100000'],
      ['UID:c', 'SUMMARY:Midnight', 'DTSTART:20261212T000000', 'DTEND:20261212T000000'],
    )
    expect(parseCalendar(text, 'UTC', WINDOW).map((e) => [e.uid, e.endsOn])).toEqual([
      ['a', '2026-12-12'],
      ['b', '2026-12-12'],
      ['c', '2026-12-12'],
    ])
  })

  it('reads a length given as a duration', () => {
    const text = ics(
      ['UID:week', 'SUMMARY:Camping', 'DTSTART;VALUE=DATE:20260601', 'DURATION:P1W'],
      ['UID:hours', 'SUMMARY:Show', 'DTSTART:20260601T200000', 'DURATION:PT3H'],
      ['UID:days', 'SUMMARY:Away', 'DTSTART:20260601T090000', 'DURATION:P2D'],
    )
    expect(parseCalendar(text, 'UTC', WINDOW).map((e) => [e.uid, e.endsOn])).toEqual([
      ['days', '2026-06-03'],
      ['hours', '2026-06-01'],
      ['week', '2026-06-07'],
    ])
  })

  it('repeats a yearly event across the window, up to its last year, Feb 29 on the 28th', () => {
    const text = ics(
      ['UID:mom', "SUMMARY:Mom's birthday", 'DTSTART;VALUE=DATE:20200229', 'RRULE:FREQ=YEARLY'],
      [
        'UID:old',
        'SUMMARY:Anniversary',
        'DTSTART;VALUE=DATE:20200301',
        'RRULE:FREQ=YEARLY;UNTIL=20261231',
      ],
    )
    expect(parseCalendar(text, 'UTC', WINDOW).map((e) => [e.uid, e.startsOn])).toEqual([
      ['mom', '2026-02-28'],
      ['old', '2026-03-01'],
      ['mom', '2027-02-28'],
    ])
  })

  it('leaves out cancelled events, events missing a start or id, and alarms’ own lines', () => {
    const text = ics(
      ['UID:x', 'SUMMARY:Called off', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20260601'],
      ['SUMMARY:No id', 'DTSTART;VALUE=DATE:20260601'],
      ['UID:y', 'SUMMARY:No start'],
      ['UID:z', 'SUMMARY:Bad start', 'DTSTART:June 1'],
      [
        'UID:kept',
        'DTSTART;VALUE=DATE:20260601',
        'BEGIN:VALARM',
        'SUMMARY:Alarm text',
        'END:VALARM',
        'SUMMARY:Wedding',
      ],
    )
    expect(parseCalendar(text, 'UTC', WINDOW).map((e) => e.title)).toEqual(['Wedding'])
  })

  it('joins folded lines, unescapes text, keeps quoted colons and trims long text', () => {
    const text = ics([
      'UID:fold',
      'DTSTART;VALUE=DATE:20260601',
      `SUMMARY;ALTREP="cid:part1@example.org":Road trip\\nto the`,
      '  coast\\; with friends',
      `LOCATION:${'x'.repeat(300)}`,
      'DESCRIPTION:',
      'not a property line',
    ])
    const [event] = parseCalendar(text, 'UTC', WINDOW)
    expect(event!.title).toBe('Road trip to the coast; with friends')
    expect(event!.location).toHaveLength(200)
  })

  it('names an untitled event, and has no location when it is blank', () => {
    const text = ics(['UID:u', 'DTSTART;VALUE=DATE:20260601', 'LOCATION:  '])
    expect(parseCalendar(text, 'UTC', WINDOW)).toMatchObject([
      { title: 'Untitled event', location: null },
    ])
  })

  it('keeps only events touching the window, once each', () => {
    const inside = ['UID:in', 'SUMMARY:In', 'DTSTART;VALUE=DATE:20260601']
    const text = ics(
      ['UID:before', 'SUMMARY:Old', 'DTSTART;VALUE=DATE:20200601'],
      ['UID:after', 'SUMMARY:Far', 'DTSTART;VALUE=DATE:20300601'],
      inside,
      inside,
      [
        'UID:span',
        'SUMMARY:New year away',
        'DTSTART;VALUE=DATE:20251230',
        'DTEND;VALUE=DATE:20260103',
      ],
    )
    expect(parseCalendar(text, 'UTC', WINDOW).map((e) => e.uid)).toEqual(['span', 'in'])
  })

  it('past MAX_EVENTS, drops the far past first, so what is coming up stays', () => {
    const past = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => [
      `UID:p${String(i).padStart(5, '0')}`,
      'SUMMARY:Weekend trip',
      'DTSTART;VALUE=DATE:20260101',
    ])
    const coming = ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;VALUE=DATE:20261210']
    const events = parseCalendar(ics(...past, coming), 'UTC', WINDOW)
    expect(events).toHaveLength(MAX_EVENTS)
    expect(events.at(-1)!.uid).toBe('rome')
    expect(events.map((e) => e.uid)).not.toContain('p00000')
  })

  it('asks what to keep before the cap, so everyday events never crowd out a trip', () => {
    const meetings = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => [
      `UID:m${i}`,
      'SUMMARY:Standup',
      'DTSTART;VALUE=DATE:20261220',
    ])
    const trip = ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;VALUE=DATE:20261210']
    const keep = (event: { title: string }) => event.title !== 'Standup'
    expect(parseCalendar(ics(...meetings, trip), 'UTC', WINDOW, keep)).toMatchObject([
      { uid: 'rome' },
    ])
  })

  it('stays within MAX_EVENTS while reading many repeating events, keeping the latest', () => {
    const daily = Array.from({ length: 15 }, (_, i) => [
      `UID:d${String(i).padStart(2, '0')}`,
      'SUMMARY:Camp',
      'DTSTART;VALUE=DATE:20260101',
      'RRULE:FREQ=DAILY',
    ])
    const events = parseCalendar(ics(...daily), 'UTC', WINDOW)
    expect(events).toHaveLength(MAX_EVENTS)
    expect(events.at(-1)!.startsOn).toBe('2027-12-31')
  })

  it('drops control characters from text and ids, which Postgres would refuse', () => {
    const text = ics([
      'UID:a\u0001b',
      'SUMMARY:Rome\u0000 trip\u001F',
      'LOCATION:\u0007',
      'DTSTART;VALUE=DATE:20260601',
    ])
    expect(parseCalendar(text, 'UTC', WINDOW)).toMatchObject([
      { uid: 'ab', title: 'Rome trip', location: null },
    ])
  })

  it('reads nothing from a file with no events', () => {
    expect(parseCalendar('BEGIN:VCALENDAR\nEND:VCALENDAR', 'UTC', WINDOW)).toEqual([])
  })
})

describe('kindOf', () => {
  const event = (title: string, startsOn = '2026-06-01', endsOn = startsOn, extra = {}) => ({
    title,
    location: null,
    startsOn,
    endsOn,
    allDay: false,
    ...extra,
  })

  it('reads what an event is from words in its title', () => {
    expect(kindOf(event('Sam and Alex wedding'))).toBe('wedding')
    expect(kindOf(event("Jo's bday"))).toBe('birthday')
    expect(kindOf(event('Birthday dinner'))).toBe('birthday')
    expect(kindOf(event('Taylor Swift concert'))).toBe('show')
    expect(kindOf(event('Flight to Denver'))).toBe('trip')
    expect(kindOf(event('✈ SFO'))).toBe('trip')
    expect(kindOf(event('Thanksgiving at home'))).toBe('holiday')
  })

  it('takes a long event, or a couple of days away somewhere, as a trip', () => {
    expect(kindOf(event('Off', '2026-06-01', '2026-06-04'))).toBe('trip')
    expect(
      kindOf(event('Off', '2026-06-01', '2026-06-02', { allDay: true, location: 'Austin' })),
    ).toBe('trip')
    expect(kindOf(event('Off', '2026-06-01', '2026-06-02', { allDay: true }))).toBeNull()
  })

  it('leaves everyday events out', () => {
    expect(kindOf(event('Team standup'))).toBeNull()
    expect(kindOf(event('Doctor check-in'))).toBeNull()
  })

  it('counts both ends of an event', () => {
    expect(daysOf({ startsOn: '2026-06-01', endsOn: '2026-06-01' })).toBe(1)
    expect(daysOf({ startsOn: '2026-06-01', endsOn: '2026-06-05' })).toBe(5)
  })
})

describe('mergeSpans', () => {
  const event = (
    kind: KindedEvent['kind'],
    title: string,
    startsOn: string,
    endsOn = startsOn,
  ) => ({
    kind,
    title,
    startsOn,
    endsOn,
  })

  it('merges a trip with its flight and hotel, named for its longest event', () => {
    expect(
      mergeSpans([
        event('trip', 'Flight to Rome', '2026-12-09'),
        event('trip', 'Hotel Rome', '2026-12-10', '2026-12-13'),
        event('trip', 'Rome trip', '2026-12-10', '2026-12-14'),
        event('trip', 'Flight home', '2026-12-15'),
        event('trip', 'Ski weekend', '2026-12-20', '2026-12-21'),
      ]),
    ).toEqual([
      event('trip', 'Rome trip', '2026-12-09', '2026-12-15'),
      event('trip', 'Ski weekend', '2026-12-20', '2026-12-21'),
    ])
  })

  it('merges back-to-back days only for kinds that run over days', () => {
    expect(
      mergeSpans([
        event('wedding', 'Rehearsal dinner', '2026-06-05'),
        event('wedding', "Sam's wedding", '2026-06-06'),
        event('holiday', 'Christmas Eve', '2026-12-24'),
        event('holiday', 'Christmas', '2026-12-25'),
        event('birthday', "Jo's birthday", '2026-03-01'),
        event('birthday', "Al's birthday", '2026-03-02'),
        event('birthday', "Jo's bday dinner", '2026-03-01'),
        event('show', 'Concert', '2026-03-01'),
      ]).map((span) => [span.kind, span.title, span.startsOn, span.endsOn]),
    ).toEqual([
      ['birthday', "Jo's birthday", '2026-03-01', '2026-03-01'],
      ['show', 'Concert', '2026-03-01', '2026-03-01'],
      ['birthday', "Al's birthday", '2026-03-02', '2026-03-02'],
      ['wedding', 'Rehearsal dinner', '2026-06-05', '2026-06-06'],
      ['holiday', 'Christmas Eve', '2026-12-24', '2026-12-25'],
    ])
  })

  it('leaves the events given as they were', () => {
    const events = [
      event('trip', 'A', '2026-01-01'),
      event('trip', 'B', '2026-01-02', '2026-01-05'),
    ]
    mergeSpans(events)
    expect(events[0]).toEqual(event('trip', 'A', '2026-01-01'))
  })
})
