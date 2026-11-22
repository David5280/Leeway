// Repeating events and time zones in a calendar file: how an RRULE expands,
// how skipped and changed repeats are applied, and which days a moment
// written on another clock falls on for the owner.

import { describe, expect, it } from 'vitest'
import { parseCalendar, type CalendarEvent } from '../src/domain/calendar/ics.js'
import { kindOf } from '../src/domain/calendar/kinds.js'
import { durationMs, momentOf } from '../src/domain/calendar/moments.js'
import { expandRule, parseRule, type Rule } from '../src/domain/calendar/recurrence.js'

/** A calendar file holding these events, each given as its lines. */
function ics(...events: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')
}

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
    expect(days(parseCalendar(text, 'UTC', birthdays))).toEqual(['2024-12-01', '2026-12-05'])
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
    expect(spans(parseCalendar(text, 'UTC', window))).toEqual([
      ['2025-01-10', '2025-01-14'],
      ['2027-01-10', '2027-01-14'],
    ])
  })

  it('honors INTERVAL and COUNT', () => {
    const text = ics(
      ['UID:a', 'SUMMARY:Reunion', 'DTSTART;VALUE=DATE:20200601', 'RRULE:FREQ=YEARLY;INTERVAL=2'],
      ['UID:b', 'SUMMARY:Festival', 'DTSTART;VALUE=DATE:20250701', 'RRULE:FREQ=YEARLY;COUNT=2'],
    )
    const events = parseCalendar(text, 'UTC', window)
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
    const events = parseCalendar(text, 'America/Denver', { from: '2026-01-01', to: '2027-01-31' })
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
    expect(days(parseCalendar(text, 'Europe/Rome', window))).toEqual([
      '2026-11-03',
      '2026-12-02',
      '2026-12-03',
    ])
  })

  it('asks what to keep once per event, and keeps a changed repeat by its own title', () => {
    const keep = (event: CalendarEvent) => kindOf(event) !== null
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
    expect(parseCalendar(text, 'UTC', window, keep).map((e) => [e.uid, e.startsOn])).toEqual([
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
    expect(days(parseCalendar(text, 'UTC', window))).toEqual(['2026-01-05', '2026-01-05'])
  })

  it('reads UNTIL written in UTC on the event’s own clock', () => {
    const text = ics([
      'UID:x',
      'SUMMARY:Concert series',
      'DTSTART;TZID=America/Denver:20261201T200000',
      // 03:00 UTC on Dec 3 is still the evening of Dec 2 in Denver.
      'RRULE:FREQ=DAILY;UNTIL=20261203T030000Z',
    ])
    expect(days(parseCalendar(text, 'America/Denver', window))).toEqual([
      '2026-12-01',
      '2026-12-02',
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
    expect(spans(parseCalendar(text, 'UTC', { from: '2026-07-01', to: '2026-07-31' }))).toEqual([
      ['2026-06-25', '2026-07-09'],
    ])
  })
})

describe('time zones', () => {
  it('reads a TZID on its own clock, moved to the owner’s day', () => {
    const text = ics([
      'UID:tokyo',
      'SUMMARY:Flight home',
      'DTSTART;TZID=Asia/Tokyo:20261129T080000',
      'DTEND;TZID=America/Denver:20261128T060000',
    ])
    expect(
      spans(parseCalendar(text, 'America/Denver', { from: '2026-11-01', to: '2026-12-31' })),
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
      spans(parseCalendar(text, 'America/Denver', { from: '2026-12-01', to: '2026-12-31' })),
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
      spans(parseCalendar(text, 'America/Denver', { from: '2026-12-01', to: '2026-12-31' })),
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

describe('parseRule', () => {
  it('reads the parts of a rule', () => {
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU;UNTIL=20261231')).toEqual({
      frequency: 'WEEKLY',
      interval: 2,
      count: null,
      until: '20261231',
      byDay: [
        { weekday: 2, nth: null },
        { weekday: 4, nth: null },
      ],
      byMonthDay: [],
      byMonth: [],
      weekStart: 0,
    })
    expect(parseRule('freq=monthly;byday=2SU,-1FR;count=3')).toMatchObject({
      byDay: [
        { weekday: 0, nth: 2 },
        { weekday: 5, nth: -1 },
      ],
      count: 3,
    })
  })

  it('refuses a broken rule, or one using parts not covered', () => {
    for (const rule of [
      undefined,
      '',
      'FREQ=HOURLY',
      'INTERVAL=2',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=DAILY;COUNT=1.5',
      'FREQ=DAILY;BYDAY=XX',
      'FREQ=DAILY;BYDAY=MONDAY',
      'FREQ=MONTHLY;BYDAY=0MO',
      'FREQ=MONTHLY;BYDAY=6MO',
      'FREQ=MONTHLY;BYMONTHDAY=32',
      'FREQ=MONTHLY;BYMONTHDAY=0',
      'FREQ=YEARLY;BYMONTH=13',
      'FREQ=WEEKLY;WKST=XX',
      'FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO',
      'FREQ=YEARLY;BYWEEKNO=20',
      'FREQ=YEARLY;BYYEARDAY=100',
      'FREQ=WEEKLY;BYDAY=2MO',
      'FREQ=YEARLY;BYDAY=20MO',
    ]) {
      expect(parseRule(rule)).toBeNull()
    }
  })
})

describe('expandRule', () => {
  const rule = (text: string) => parseRule(text) as Rule
  const all = { from: '2000-01-01', to: '2030-12-31', until: null }

  it('repeats daily, narrowed by BYDAY, BYMONTH and BYMONTHDAY', () => {
    const bounds = { ...all, to: '2026-12-31' }
    expect(expandRule('2026-12-24', rule('FREQ=DAILY;INTERVAL=3'), bounds)).toEqual([
      '2026-12-24',
      '2026-12-27',
      '2026-12-30',
    ])
    expect(expandRule('2026-12-24', rule('FREQ=DAILY;BYDAY=SA,SU'), bounds)).toEqual([
      '2026-12-24',
      '2026-12-26',
      '2026-12-27',
    ])
    expect(
      expandRule('2026-01-01', rule('FREQ=DAILY;BYMONTH=2,3;BYMONTHDAY=-1'), {
        ...all,
        to: '2026-06-30',
      }),
    ).toEqual(['2026-01-01', '2026-02-28', '2026-03-31'])
  })

  it('repeats weekly on the given days, weeks starting on WKST', () => {
    // A Tuesday; every other week on Monday and Thursday, weeks starting Sunday.
    expect(
      expandRule('2026-12-01', rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=SU;COUNT=4'), all),
    ).toEqual(['2026-12-01', '2026-12-03', '2026-12-14', '2026-12-17'])
    expect(expandRule('2026-12-01', rule('FREQ=WEEKLY;BYMONTH=1;COUNT=2'), all)).toEqual([
      '2026-12-01',
      '2027-01-05',
    ])
  })

  it('repeats monthly by day of the month or by which weekday', () => {
    expect(expandRule('2026-01-31', rule('FREQ=MONTHLY;COUNT=3'), all)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ])
    expect(expandRule('2026-11-01', rule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'), all)).toEqual([
      '2026-11-01',
      '2026-11-27',
      '2026-12-25',
    ])
    expect(
      expandRule('2026-01-01', rule('FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1,2,3,4,5,6,7;COUNT=3'), all),
    ).toEqual(['2026-01-01', '2026-01-05', '2026-02-02'])
    expect(expandRule('2026-01-15', rule('FREQ=MONTHLY;BYMONTH=6;COUNT=2'), all)).toEqual([
      '2026-01-15',
      '2026-06-15',
    ])
  })

  it('repeats yearly, by month and the weekday within it', () => {
    // Thanksgiving: the fourth Thursday of November.
    expect(expandRule('2026-11-26', rule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3'), all)).toEqual(
      ['2026-11-26', '2027-11-25', '2028-11-23'],
    )
    expect(expandRule('2026-03-10', rule('FREQ=YEARLY;BYMONTHDAY=1;COUNT=2'), all)).toEqual([
      '2026-03-10',
      '2027-03-01',
    ])
    expect(expandRule('2026-01-10', rule('FREQ=YEARLY;BYMONTH=6,1;COUNT=3'), all)).toEqual([
      '2026-01-10',
      '2026-06-10',
      '2027-01-10',
    ])
    expect(expandRule('2024-02-29', rule('FREQ=YEARLY;COUNT=2'), all)).toEqual([
      '2024-02-29',
      '2025-02-28',
    ])
  })

  it('stops at UNTIL and at the end of the window, and starts at the window', () => {
    expect(
      expandRule('2026-01-01', rule('FREQ=MONTHLY'), {
        from: '2026-03-01',
        to: '2026-05-31',
        until: '2026-04-30',
      }),
    ).toEqual(['2026-03-01', '2026-04-01'])
    // Long before the window, without a count: the years between are skipped, not walked.
    expect(
      expandRule('1900-06-01', rule('FREQ=DAILY'), {
        from: '2026-06-01',
        to: '2026-06-02',
        until: null,
      }),
    ).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('gives up on a rule that never picks a day, rather than walk forever', () => {
    expect(expandRule('2026-01-01', rule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30'), all)).toEqual([
      '2026-01-01',
    ])
  })
})
