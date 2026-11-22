// Reading a calendar file: its events and their days, the events kept, the
// cap on how many, and which events are likely to cost money.

import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { MAX_EVENTS, parseCalendar, type CalendarEvent } from '../src/domain/calendar/ics.js'
import { daysOf, kindOf, mayHaveKind } from '../src/domain/calendar/kinds.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

const WINDOW = { from: '2026-01-01', to: '2027-12-31' }

describe('parseCalendar', () => {
  it('reads all-day events, with their end day exclusive as the format says', () => {
    const text = ics([
      'UID:trip-1',
      'SUMMARY:Lisbon trip',
      'LOCATION:Lisbon\\, Portugal',
      'DTSTART;VALUE=DATE:20261210',
      'DTEND;VALUE=DATE:20261215',
    ])
    expect(eventsIn(text, 'UTC', WINDOW)).toEqual([
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
    const events = eventsIn(text, 'America/New_York', WINDOW)
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
    expect(eventsIn(text, 'UTC', WINDOW).map((e) => [e.uid, e.endsOn])).toEqual([
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
    expect(eventsIn(text, 'UTC', WINDOW).map((e) => [e.uid, e.endsOn])).toEqual([
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
    expect(eventsIn(text, 'UTC', WINDOW).map((e) => [e.uid, e.startsOn])).toEqual([
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
    expect(eventsIn(text, 'UTC', WINDOW).map((e) => e.title)).toEqual(['Wedding'])
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
    const [event] = eventsIn(text, 'UTC', WINDOW)
    expect(event!.title).toBe('Road trip to the coast; with friends')
    expect(event!.location).toHaveLength(200)
  })

  it('names an untitled event, and has no location when it is blank', () => {
    const text = ics(['UID:u', 'DTSTART;VALUE=DATE:20260601', 'LOCATION:  '])
    expect(eventsIn(text, 'UTC', WINDOW)).toMatchObject([
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
    expect(eventsIn(text, 'UTC', WINDOW).map((e) => e.uid)).toEqual(['span', 'in'])
  })

  it('past MAX_EVENTS, keeps the events nearest today and says it left some out', () => {
    const past = Array.from({ length: MAX_EVENTS }, (_, i) => [
      `UID:p${String(i).padStart(5, '0')}`,
      'SUMMARY:Weekend trip',
      'DTSTART;VALUE=DATE:20260101',
    ])
    const soon = ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;VALUE=DATE:20261210']
    const far = ['UID:lisbon', 'SUMMARY:Lisbon trip', 'DTSTART;VALUE=DATE:20271231']
    const { events, capped } = parseCalendar(ics(...past, soon, far), 'UTC', WINDOW, {
      today: '2026-12-01',
    })
    expect(capped).toBe(true)
    expect(events).toHaveLength(MAX_EVENTS)
    // Rome is 9 days off and the past trips 334; Lisbon, 395 days off, goes, with one past trip.
    expect(events.at(-1)!.uid).toBe('rome')
    expect(events.map((e) => e.uid)).not.toContain('lisbon')
    expect(events.map((e) => e.uid)).not.toContain('p04999')
    // Within the cap, nothing is left out and nothing is said.
    expect(parseCalendar(ics(soon, far), 'UTC', WINDOW).capped).toBe(false)
  })

  it('asks what to keep before the cap, so everyday events never crowd out a trip', () => {
    const meetings = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => [
      `UID:m${i}`,
      'SUMMARY:Standup',
      'DTSTART;VALUE=DATE:20261220',
    ])
    const trip = ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;VALUE=DATE:20261210']
    const keep = {
      mayKeep: ({ title }: { title: string }) => title !== 'Standup',
      keeps: () => true,
    }
    expect(eventsIn(ics(...meetings, trip), 'UTC', WINDOW, { keep })).toMatchObject([
      { uid: 'rome' },
    ])
  })

  it('asks for the last word only on events the first look kept, after working out their days', () => {
    const text = ics(
      ['UID:standup', 'SUMMARY:Standup', 'DTSTART;TZID=America/Denver:20261210T090000'],
      ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;TZID=Europe/Rome:20261210T230000'],
    )
    const keeps = vi.fn(() => true)
    const keep = { mayKeep: ({ title }: { title: string }) => title !== 'Standup', keeps }
    expect(eventsIn(text, 'America/Denver', WINDOW, { keep })).toMatchObject([{ uid: 'rome' }])
    // 11 PM in Rome is mid-afternoon in Denver, so the trip's day is worked out before the last word.
    expect(keeps.mock.calls).toEqual([
      [expect.objectContaining({ uid: 'rome', startsOn: '2026-12-10' })],
    ])
  })

  it('keeps the same events with the first look as without it', () => {
    // Events on every kind of clock and length, some a first look might wrongly pass over.
    const text = ics(
      [
        'UID:a',
        'SUMMARY:Standup',
        'DTSTART;TZID=America/Denver:20261210T090000',
        'RRULE:FREQ=DAILY',
      ],
      ['UID:b', 'SUMMARY:Flight to Rome', 'DTSTART:20261210T230000Z', 'DTEND:20261211T090000Z'],
      [
        'UID:c',
        'SUMMARY:Off',
        'DTSTART;TZID=Asia/Tokyo:20261212T080000',
        'DTEND;TZID=Asia/Tokyo:20261214T200000',
      ],
      ['UID:d', 'SUMMARY:Away', 'DTSTART;VALUE=DATE:20261215', 'DTEND;VALUE=DATE:20261221'],
      [
        'UID:e',
        'SUMMARY:Lunch',
        'DTSTART;TZID=Pacific/Kiritimati:20261219T235900',
        'DURATION:P1DT1M',
      ],
      ['UID:f', 'SUMMARY:Lunch', 'LOCATION:Paris', 'DTSTART:20261220T120000', 'DURATION:PT36H'],
      ['UID:g', 'SUMMARY:Sam’s wedding', 'DTSTART;TZID=Europe/London:20261221T150000'],
      ['UID:h', 'SUMMARY:Anniversary', 'DTSTART;VALUE=DATE:20101222', 'RRULE:FREQ=YEARLY'],
      [
        'UID:i',
        'SUMMARY:Team sync',
        'DTSTART;TZID=Europe/Rome:20261201T100000',
        'DTEND;TZID=Europe/Rome:20261201T110000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TH',
      ],
    )
    const keeps = (event: CalendarEvent) => kindOf(event) !== null
    for (const zone of ['America/Denver', 'Pacific/Auckland', 'UTC']) {
      const looked = eventsIn(text, zone, WINDOW, { keep: { mayKeep: mayHaveKind, keeps } })
      const unlooked = eventsIn(text, zone, WINDOW, { keep: { mayKeep: () => true, keeps } })
      expect(looked, zone).toEqual(unlooked)
      expect(
        looked.map((event) => event.uid),
        zone,
      ).toEqual(expect.arrayContaining(['b', 'd', 'g']))
    }
  })

  it('stays within MAX_EVENTS while reading many repeating events, keeping those nearest today', () => {
    const daily = Array.from({ length: 15 }, (_, i) => [
      `UID:d${String(i).padStart(2, '0')}`,
      'SUMMARY:Camp',
      'DTSTART;VALUE=DATE:20260101',
      'RRULE:FREQ=DAILY',
    ])
    const { events, capped } = parseCalendar(ics(...daily), 'UTC', WINDOW, { today: '2026-12-01' })
    expect(capped).toBe(true)
    expect(events).toHaveLength(MAX_EVENTS)
    // Fifteen a day: 166 days either side of today make 4,995, and the last five come from the
    // day after, since of two as near the one still to come stays.
    expect(events[0]!.startsOn).toBe(addDays('2026-12-01', -166))
    expect(events.at(-1)!.startsOn).toBe(addDays('2026-12-01', 167))
    expect(events.filter((e) => e.startsOn === addDays('2026-12-01', 167))).toHaveLength(5)
  })

  it('drops control characters from text and ids, which Postgres would refuse', () => {
    const text = ics([
      'UID:a\u0001b',
      'SUMMARY:Rome\u0000 trip\u001F',
      'LOCATION:\u0007',
      'DTSTART;VALUE=DATE:20260601',
    ])
    expect(eventsIn(text, 'UTC', WINDOW)).toMatchObject([
      { uid: 'ab', title: 'Rome trip', location: null },
    ])
  })

  it('reads nothing from a file with no events', () => {
    expect(eventsIn('BEGIN:VCALENDAR\nEND:VCALENDAR', 'UTC', WINDOW)).toEqual([])
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
