// Reading a calendar file: its events and the days each covers, and the
// events left out because they are not happening (cancelled, or declined by
// the calendar's owner).

import { describe, expect, it } from 'vitest'
import { calendarAddressOf } from '../src/domain/calendar/components.js'
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

describe('invitations the calendar’s owner declined', () => {
  /** A calendar file named for its owner's address, as Google names a person's main calendar. */
  const named = (name: string, ...events: string[][]) =>
    ics(...events).replace('VERSION:2.0', `VERSION:2.0\r\nX-WR-CALNAME:${name}`)
  /** A wedding the owner answered, others invited too. */
  const wedding = (uid: string, answer: string) => [
    `UID:${uid}`,
    "SUMMARY:Sam's wedding",
    'DTSTART;VALUE=DATE:20261212',
    'ATTENDEE;PARTSTAT=ACCEPTED;CN=Sam:mailto:sam@example.com',
    `ATTENDEE;CN=Me;PARTSTAT=${answer}:mailto:Me@Example.com`,
  ]

  it('leaves out an event the owner declined, whatever the case of the address', () => {
    const text = named('me@example.com', wedding('no', 'DECLINED'), wedding('yes', 'ACCEPTED'))
    expect(eventsIn(text, 'UTC', WINDOW).map((event) => event.uid)).toEqual(['yes'])
  })

  it('keeps an event someone else declined, and every event when the owner is not known', () => {
    const declinedBySam = [
      'UID:sam',
      'SUMMARY:Trip',
      'DTSTART;VALUE=DATE:20261212',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:sam@example.com',
    ]
    expect(eventsIn(named('me@example.com', declinedBySam), 'UTC', WINDOW)).toHaveLength(1)
    // A calendar named as a person names it says nothing of whose it is.
    expect(eventsIn(named('Family', wedding('no', 'DECLINED')), 'UTC', WINDOW)).toHaveLength(1)
    expect(eventsIn(ics(wedding('no', 'DECLINED')), 'UTC', WINDOW)).toHaveLength(1)
  })

  it('leaves out one repeat the owner declined, keeping the rest', () => {
    const text = named(
      'me@example.com',
      ['UID:dinner', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261205', 'RRULE:FREQ=WEEKLY;COUNT=3'],
      [
        'UID:dinner',
        'RECURRENCE-ID;VALUE=DATE:20261212',
        'SUMMARY:Trip',
        'DTSTART;VALUE=DATE:20261212',
        'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com',
      ],
    )
    expect(eventsIn(text, 'UTC', WINDOW).map((event) => event.startsOn)).toEqual([
      '2026-12-05',
      '2026-12-19',
    ])
  })

  it('reads whose calendar it is only from its name before the first event', () => {
    expect(calendarAddressOf('BEGIN:VCALENDAR\r\nX-WR-CALNAME: Me@Example.com \r\n')).toBe(
      'me@example.com',
    )
    expect(calendarAddressOf('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Work\r\nBEGIN:VEVENT')).toBeNull()
    const inEvent = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nX-WR-CALNAME:me@example.com\r\nEND:VEVENT'
    expect(calendarAddressOf(inEvent)).toBeNull()
    // With a parameter, or written as a mailto: link, it is the same address.
    const spelled = ['X-WR-CALNAME;VALUE=TEXT:me@example.com', 'X-WR-CALNAME:MAILTO:me@example.com']
    for (const line of spelled) expect(calendarAddressOf(`${line}\r\n`)).toBe('me@example.com')
  })

  it('knows the owner’s answer however either side writes the address', () => {
    const bare = ['UID:bare', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261212']
    const declined = [...bare, 'ATTENDEE;PARTSTAT=DECLINED:Me@Example.com']
    expect(eventsIn(named('me@example.com', declined), 'UTC', WINDOW)).toEqual([])
    expect(
      eventsIn(named('mailto:me@example.com', wedding('no', 'DECLINED')), 'UTC', WINDOW),
    ).toEqual([])
  })
})
