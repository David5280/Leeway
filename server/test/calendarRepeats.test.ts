// Repeating events in a calendar file: how skipped and changed repeats are
// applied, which repeats are kept, and how a rule's days reach the window.

import { describe, expect, it } from 'vitest'
import { eventIdOf, type CalendarEvent } from '../src/domain/calendar/ics.js'
import { kindOf, mayHaveKind } from '../src/domain/calendar/kinds.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

const days = (events: CalendarEvent[]) => events.map((e) => e.startsOn)
const spans = (events: CalendarEvent[]) => events.map((e) => [e.startsOn, e.endsOn])

describe('repeating events in a file', () => {
  const window = { from: '2024-01-01', to: '2027-12-31' }

  it('skips an EXDATE and moves a repeat changed on its own', () => {
    const text = ics(
      [
        'UID:sam',
        "SUMMARY:Sam's birthday",
        'DTSTART;VALUE=DATE:20241201',
        'RRULE:FREQ=YEARLY',
        'EXDATE;VALUE=DATE:20251201',
      ],
      [
        'UID:sam',
        "SUMMARY:Sam's birthday",
        'RECURRENCE-ID;VALUE=DATE:20261201',
        'DTSTART;VALUE=DATE:20261205',
      ],
    )
    const birthdays = { from: '2024-01-01', to: '2026-12-31' }
    expect(days(eventsIn(text, 'UTC', birthdays))).toEqual(['2024-12-01', '2026-12-05'])
  })

  it('removes a repeat cancelled on its own', () => {
    const text = ics(
      [
        'UID:ski',
        'SUMMARY:Ski trip',
        'DTSTART;VALUE=DATE:20250110',
        'DTEND;VALUE=DATE:20250115',
        'RRULE:FREQ=YEARLY',
      ],
      [
        'UID:ski',
        'RECURRENCE-ID;VALUE=DATE:20260110',
        'STATUS:CANCELLED',
        'DTSTART;VALUE=DATE:20260110',
      ],
    )
    expect(spans(eventsIn(text, 'UTC', window))).toEqual([
      ['2025-01-10', '2025-01-14'],
      ['2027-01-10', '2027-01-14'],
    ])
  })

  it('honors INTERVAL and COUNT', () => {
    const text = ics(
      ['UID:a', 'SUMMARY:Reunion', 'DTSTART;VALUE=DATE:20200601', 'RRULE:FREQ=YEARLY;INTERVAL=2'],
      ['UID:b', 'SUMMARY:Festival', 'DTSTART;VALUE=DATE:20250701', 'RRULE:FREQ=YEARLY;COUNT=2'],
    )
    const events = eventsIn(text, 'UTC', window)
    expect(days(events.filter((e) => e.uid === 'a'))).toEqual(['2024-06-01', '2026-06-01'])
    expect(days(events.filter((e) => e.uid === 'b'))).toEqual(['2025-07-01', '2026-07-01'])
  })

  it('repeats a monthly event into the window', () => {
    const text = ics([
      'UID:jazz',
      'SUMMARY:Jazz concert',
      'DTSTART;TZID=America/Denver:20260915T200000',
      'DURATION:PT2H',
      'RRULE:FREQ=MONTHLY',
    ])
    const events = eventsIn(text, 'America/Denver', { from: '2026-01-01', to: '2027-01-31' })
    expect(days(events)).toEqual([
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ])
  })

  it('matches a timed EXDATE and RECURRENCE-ID on the event’s own clock, many to a line', () => {
    const text = ics(
      [
        'UID:class',
        'SUMMARY:Pottery class',
        'DTSTART;TZID=Europe/Rome:20261103T190000',
        'RRULE:FREQ=WEEKLY;COUNT=5',
        'EXDATE;TZID=Europe/Rome:20261110T190000,20261117T190000',
        // The same moment written in UTC is the same repeat.
        'EXDATE:20261124T180000Z',
        'EXDATE:not a date',
      ],
      [
        'UID:class',
        'SUMMARY:Pottery class',
        'RECURRENCE-ID;TZID=Europe/Rome:20261201T190000',
        'DTSTART;TZID=Europe/Rome:20261202T190000',
      ],
      // A changed repeat that does not say which one it replaces replaces none.
      ['UID:class', 'SUMMARY:Pottery class', 'RECURRENCE-ID:soon', 'DTSTART:20261203T190000'],
    )
    expect(days(eventsIn(text, 'Europe/Rome', window))).toEqual([
      '2026-11-03',
      '2026-12-02',
      '2026-12-03',
    ])
  })

  it('asks what to keep once per event, and keeps a changed repeat by its own title', () => {
    const keep = { mayKeep: mayHaveKind, keeps: (event: CalendarEvent) => kindOf(event) !== null }
    const text = ics(
      ['UID:gym', 'SUMMARY:Gym', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=WEEKLY'],
      [
        'UID:gym',
        'SUMMARY:Flight to Rome',
        'RECURRENCE-ID;VALUE=DATE:20260112',
        'DTSTART;VALUE=DATE:20260112',
      ],
      ['UID:hike', 'SUMMARY:Camping trip', 'DTSTART;VALUE=DATE:20260301', 'RRULE:FREQ=YEARLY'],
      [
        'UID:hike',
        'SUMMARY:Errands',
        'RECURRENCE-ID;VALUE=DATE:20270301',
        'DTSTART;VALUE=DATE:20270301',
      ],
      [
        'UID:lost',
        'SUMMARY:Wedding',
        'RECURRENCE-ID;VALUE=DATE:20260601',
        'DTSTART;VALUE=DATE:20260601',
      ],
      ['UID:void', 'RECURRENCE-ID;VALUE=DATE:20260601'],
    )
    expect(eventsIn(text, 'UTC', window, { keep }).map((e) => [e.uid, e.startsOn])).toEqual([
      ['gym', '2026-01-12'],
      ['hike', '2026-03-01'],
      ['lost', '2026-06-01'],
    ])
  })

  it('keeps an event once, on its first day, when its rule is not one that is expanded', () => {
    const text = ics(
      [
        'UID:a',
        'SUMMARY:Gala',
        'DTSTART;VALUE=DATE:20260105',
        'RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO',
      ],
      ['UID:b', 'SUMMARY:Show', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=HOURLY'],
    )
    expect(days(eventsIn(text, 'UTC', window))).toEqual(['2026-01-05', '2026-01-05'])
  })

  it('reads UNTIL written in UTC on the event’s own clock', () => {
    const text = ics([
      'UID:x',
      'SUMMARY:Concert series',
      'DTSTART;TZID=America/Denver:20261201T200000',
      // 03:00 UTC on Dec 3 is still the evening of Dec 2 in Denver.
      'RRULE:FREQ=DAILY;UNTIL=20261203T030000Z',
    ])
    expect(days(eventsIn(text, 'America/Denver', window))).toEqual(['2026-12-01', '2026-12-02'])
  })

  it('ends a timed repeat at UNTIL’s moment, not at the end of its day', () => {
    const weekly = (until: string) =>
      ics([
        'UID:x',
        'SUMMARY:Comedy show',
        'DTSTART;TZID=America/Denver:20261102T230000',
        `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      ])
    // 05:59:59 UTC on Nov 24 is 10:59:59 PM on Nov 23 in Denver: an hour before that week's show.
    expect(days(eventsIn(weekly('20261124T055959Z'), 'America/Denver', window))).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ])
    // UNTIL at the very moment of a repeat still takes it.
    expect(days(eventsIn(weekly('20261124T060000Z'), 'America/Denver', window))).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ])
  })

  it('leaves out the changed repeats of an event called off as a whole', () => {
    const text = ics(
      [
        'UID:club',
        'SUMMARY:Concert series',
        'STATUS:CANCELLED',
        'DTSTART;VALUE=DATE:20261201',
        'RRULE:FREQ=WEEKLY;COUNT=4',
      ],
      [
        'UID:club',
        'SUMMARY:Concert series finale',
        'RECURRENCE-ID;VALUE=DATE:20261222',
        'DTSTART;VALUE=DATE:20261223',
      ],
      // A changed repeat of an event still on is kept.
      ['UID:sam', "SUMMARY:Sam's birthday", 'DTSTART;VALUE=DATE:20241201', 'RRULE:FREQ=YEARLY'],
      [
        'UID:sam',
        "SUMMARY:Sam's birthday",
        'RECURRENCE-ID;VALUE=DATE:20261201',
        'DTSTART;VALUE=DATE:20261205',
      ],
    )
    expect(eventsIn(text, 'UTC', window).map((e) => [e.uid, e.startsOn])).toEqual([
      ['sam', '2024-12-01'],
      ['sam', '2025-12-01'],
      ['sam', '2026-12-05'],
      ['sam', '2027-12-01'],
    ])
  })

  it('finds a long repeat that starts before the window but runs into it', () => {
    const text = ics([
      'UID:x',
      'SUMMARY:Summer away',
      'DTSTART;VALUE=DATE:20230625',
      'DTEND;VALUE=DATE:20230710',
      'RRULE:FREQ=YEARLY',
    ])
    expect(spans(eventsIn(text, 'UTC', { from: '2026-07-01', to: '2026-07-31' }))).toEqual([
      ['2026-06-25', '2026-07-09'],
    ])
  })

  it('knows each repeat by the day it was set for, a repeat moved on its own too', () => {
    const text = ics(
      [
        'UID:acme',
        'SUMMARY:Work trip to Acme',
        'DTSTART;VALUE=DATE:20261010',
        'DTEND;VALUE=DATE:20261013',
        'RRULE:FREQ=MONTHLY;COUNT=3',
      ],
      [
        'UID:acme',
        'SUMMARY:Work trip to Acme',
        'RECURRENCE-ID;VALUE=DATE:20261110',
        'DTSTART;VALUE=DATE:20261201',
        'DTEND;VALUE=DATE:20261204',
      ],
      ['UID:once', 'SUMMARY:Lisbon trip', 'DTSTART;VALUE=DATE:20261220'],
    )
    expect(eventsIn(text, 'UTC', window).map((e) => [e.startsOn, eventIdOf(e)])).toEqual([
      ['2026-10-10', 'acme 2026-10-10'],
      ['2026-12-01', 'acme 2026-11-10'],
      ['2026-12-10', 'acme 2026-12-10'],
      ['2026-12-20', 'once'],
    ])
  })

  it('reads a RECURRENCE-ID written in UTC on its series’ own clock', () => {
    const text = ics(
      [
        'UID:class',
        'SUMMARY:Pottery class',
        // Half past midnight in Rome is still the day before in UTC.
        'DTSTART;TZID=Europe/Rome:20261103T003000',
        'RRULE:FREQ=WEEKLY;COUNT=2',
      ],
      [
        'UID:class',
        'SUMMARY:Pottery class',
        'RECURRENCE-ID:20261109T233000Z',
        'DTSTART;TZID=Europe/Rome:20261111T003000',
      ],
    )
    expect(eventsIn(text, 'Europe/Rome', window).map((e) => e.repeatOn)).toEqual([
      '2026-11-03',
      '2026-11-10',
    ])
  })
})
