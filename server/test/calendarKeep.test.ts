// Which events a calendar read keeps: those likely to cost money, sorted by
// a first look before any time zone math and a last word after, and no more
// than MAX_EVENTS, the nearest today.

import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { MAX_EVENTS, parseCalendar, type CalendarEvent } from '../src/domain/calendar/ics.js'
import { daysOf, kindOf, mayHaveKind } from '../src/domain/calendar/kinds.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

const WINDOW = { from: '2026-01-01', to: '2027-12-31' }

describe('keeping events', () => {
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
