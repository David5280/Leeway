// Repeating events and time zones in a calendar file: how an RRULE expands,
// how skipped and changed repeats are applied, and which days a moment
// written on another clock falls on for the owner.

import { describe, expect, it } from 'vitest'
import { parseCalendar, type CalendarEvent } from '../src/domain/calendar/ics.js'
import { kindOf } from '../src/domain/calendar/kinds.js'
import { durationMs, momentOf } from '../src/domain/calendar/moments.js'
import { expandRule, workBudget } from '../src/domain/calendar/recurrence.js'
import { parseRule, type Rule } from '../src/domain/calendar/rule.js'

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

  it('ends a timed repeat at UNTIL’s moment, not at the end of its day', () => {
    const weekly = (until: string) =>
      ics([
        'UID:x',
        'SUMMARY:Comedy show',
        'DTSTART;TZID=America/Denver:20261102T230000',
        `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      ])
    // 05:59:59 UTC on Nov 24 is 10:59:59 PM on Nov 23 in Denver: an hour before that week's show.
    expect(days(parseCalendar(weekly('20261124T055959Z'), 'America/Denver', window))).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ])
    // UNTIL at the very moment of a repeat still takes it.
    expect(days(parseCalendar(weekly('20261124T060000Z'), 'America/Denver', window))).toEqual([
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
    expect(parseCalendar(text, 'UTC', window).map((e) => [e.uid, e.startsOn])).toEqual([
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

  it('walks a rule that never picks a day only across the window, however old it is', () => {
    const budget = workBudget()
    const never = rule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30')
    const window = { from: '2023-11-01', to: '2027-11-23', until: null }
    expect(expandRule('1900-01-01', never, window, budget)).toEqual([])
    // The years from 1900 are skipped, and the walk ends with the window's last year.
    const walked = workBudget().unitsLeft - budget.unitsLeft
    expect(walked).toBeGreaterThan(0)
    expect(walked).toBeLessThanOrEqual(6)
    expect(budget.ranOut).toBe(false)
  })

  it('ends a counted rule at the window too, rather than walk on to its count', () => {
    const budget = workBudget()
    const counted = rule('FREQ=DAILY;COUNT=100000;BYMONTH=2;BYMONTHDAY=30')
    expect(expandRule('2026-01-01', counted, { ...all, to: '2026-12-31' }, budget)).toEqual([
      '2026-01-01',
    ])
    // A unit for each of the year's 365 days looked at, and one for the first day picked.
    expect(workBudget().unitsLeft - budget.unitsLeft).toBe(366)
  })

  it('still finds the right days for rules begun long before the window', () => {
    const june = { from: '2026-06-01', to: '2026-06-30', until: null }
    expect(expandRule('1900-03-15', rule('FREQ=YEARLY'), { ...all, from: '2026-01-01' })).toEqual([
      '2026-03-15',
      '2027-03-15',
      '2028-03-15',
      '2029-03-15',
      '2030-03-15',
    ])
    expect(expandRule('1980-01-01', rule('FREQ=WEEKLY;INTERVAL=2'), june)).toEqual([
      '2026-06-02',
      '2026-06-16',
      '2026-06-30',
    ])
    expect(
      expandRule('1950-01-27', rule('FREQ=MONTHLY;BYDAY=-1FR'), { ...june, to: '2026-07-31' }),
    ).toEqual(['2026-06-26', '2026-07-31'])
    // A count from long before: 3,000 days from 2020 runs to 2028-03-18.
    expect(
      expandRule('2020-01-01', rule('FREQ=DAILY;COUNT=3000'), { ...june, to: '2026-06-03' }),
    ).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(
      expandRule('2020-01-01', rule('FREQ=DAILY;COUNT=3000'), {
        from: '2028-03-17',
        to: '2028-12-31',
        until: null,
      }),
    ).toEqual(['2028-03-17', '2028-03-18'])
  })

  it('counts a COUNT without walking when each period picks the same number of days', () => {
    const budget = workBudget()
    const window = { from: '2023-11-01', to: '2027-11-23', until: null }
    // 40,000 days from 1900 end in 2009, long before the window: nothing, at once.
    expect(expandRule('1900-01-01', rule('FREQ=DAILY;COUNT=40000'), window, budget)).toEqual([])
    expect(workBudget().unitsLeft - budget.unitsLeft).toBeLessThanOrEqual(2)
  })

  it('finds the same days skipping ahead as walking from the first day', () => {
    // Each count runs past the window's start and ends within or after it.
    const cases: [string, string][] = [
      ['2000-01-03', 'FREQ=DAILY;COUNT=4000'],
      ['2000-01-03', 'FREQ=DAILY;INTERVAL=3;COUNT=1300'],
      ['2001-05-02', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH,MO;COUNT=500'],
      ['2001-05-02', 'FREQ=WEEKLY;COUNT=500'],
      ['2002-01-15', 'FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=200'],
      ['2002-01-31', 'FREQ=MONTHLY;COUNT=60'],
      ['2002-01-12', 'FREQ=MONTHLY;BYDAY=2SU;COUNT=100'],
      ['2003-03-10', 'FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=10;COUNT=16'],
      ['2003-03-10', 'FREQ=YEARLY;BYMONTHDAY=10,20;COUNT=16'],
      ['2004-02-29', 'FREQ=YEARLY;COUNT=8'],
    ]
    const window = { from: '2010-01-01', to: '2011-12-31', until: null }
    for (const [first, text] of cases) {
      const walked = expandRule(first, rule(text), { ...window, from: first })
      const inWindow = walked.filter((date) => date >= window.from)
      expect(expandRule(first, rule(text), window), text).toEqual(inWindow)
      expect(inWindow.length, text).toBeGreaterThan(0)
    }
  })

  it('stops where its budget runs out, and says so', () => {
    // Each day costs two units: one to look at it, one for picking it.
    const budget = workBudget(10)
    const days = expandRule('2026-01-01', rule('FREQ=DAILY'), all, budget)
    expect(days).toHaveLength(5)
    expect(budget).toEqual({ unitsLeft: 0, ranOut: true })
    // A rule with nothing left to spend gives nothing.
    expect(expandRule('2026-01-01', rule('FREQ=YEARLY'), all, budget)).toEqual([])
  })
})

describe('a file built to keep the server busy', () => {
  const window = { from: '2023-11-01', to: '2027-11-23' }
  /** An event repeating every February 30th since 1900, which never comes. */
  const never = (i: number) => [
    `UID:never-${i}`,
    `SUMMARY:Birthday ${i}`,
    'DTSTART;VALUE=DATE:19000101',
    'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
  ]

  it('reads hundreds of rules that never pick a day in a moment', () => {
    const text = ics(...Array.from({ length: 200 }, (_, i) => never(i)))
    const budget = workBudget()
    const started = performance.now()
    // Each keeps its first day, long before the window, so none is in it.
    expect(parseCalendar(text, 'UTC', window, () => true, budget)).toEqual([])
    // Before, each walked 20,000 years: seconds on end. Now a few years each.
    expect(performance.now() - started).toBeLessThan(1000)
    expect(workBudget().unitsLeft - budget.unitsLeft).toBeLessThanOrEqual(200 * 6)
  })

  it('reads rules counted from a century ago in a moment', () => {
    const counted = Array.from({ length: 25 }, (_, i) => [
      `UID:counted-${i}`,
      `SUMMARY:Birthday ${i}`,
      'DTSTART;VALUE=DATE:19000101',
      'RRULE:FREQ=DAILY;COUNT=40000',
    ])
    const budget = workBudget()
    const started = performance.now()
    expect(parseCalendar(ics(...counted), 'UTC', window, () => true, budget)).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
    expect(budget).toMatchObject({ ranOut: false })
    expect(workBudget().unitsLeft - budget.unitsLeft).toBeLessThanOrEqual(25 * 2)
  })

  it('leaves out only the rules that cost too much, within a fraction of a second', () => {
    // Every Monday for 40,000 Mondays from 1900: walked day by day, far past any fair share.
    const greedy = Array.from({ length: 25 }, (_, i) => [
      `UID:greedy-${i}`,
      `SUMMARY:Camp ${i}`,
      'DTSTART;VALUE=DATE:19000101',
      'RRULE:FREQ=DAILY;BYDAY=MO;COUNT=40000',
    ])
    const text = ics(
      ...greedy,
      ['UID:mom', "SUMMARY:Mom's birthday", 'DTSTART;VALUE=DATE:20200301', 'RRULE:FREQ=YEARLY'],
      ['UID:rome', 'SUMMARY:Rome trip', 'DTSTART;VALUE=DATE:20261210'],
    )
    const budget = workBudget()
    const started = performance.now()
    const events = parseCalendar(text, 'UTC', window, () => true, budget)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(budget.ranOut).toBe(true)
    expect(budget.unitsLeft).toBeGreaterThanOrEqual(0)
    // The birthday listed after them is kept, every year of the window.
    expect(events.map((event) => [event.uid, event.startsOn])).toEqual([
      ['mom', '2024-03-01'],
      ['mom', '2025-03-01'],
      ['mom', '2026-03-01'],
      ['rome', '2026-12-10'],
      ['mom', '2027-03-01'],
    ])
  })

  it.each([
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=40000',
    'FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=40000',
    'FREQ=WEEKLY;BYMONTH=1;COUNT=40000',
    'FREQ=DAILY;BYMONTHDAY=-1;COUNT=40000',
  ])('stops %s from a century ago within a fraction of a second', (rule) => {
    // Rules whose count cannot be skipped, each made to cost the most per period it can.
    const costly = Array.from({ length: 25 }, (_, i) => [
      `UID:costly-${i}`,
      `SUMMARY:Camp ${i}`,
      'DTSTART;VALUE=DATE:19000101',
      `RRULE:${rule}`,
    ])
    const budget = workBudget()
    const started = performance.now()
    parseCalendar(ics(...costly), 'UTC', window, () => true, budget)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(budget.ranOut).toBe(true)
  })

  it('shares what one rule leaves among the rest, so a few costly ones can still finish', () => {
    // Each needs about 3,000 units: more than a first share, well within what is left.
    const daily = (i: number) => [
      `UID:daily-${i}`,
      `SUMMARY:Camp ${i}`,
      'DTSTART;VALUE=DATE:20231101',
      'RRULE:FREQ=DAILY',
    ]
    const budget = workBudget()
    const events = parseCalendar(ics(daily(1), daily(2)), 'UTC', window, () => true, budget)
    expect(budget.ranOut).toBe(false)
    expect(events.filter((event) => event.uid === 'daily-2')).toHaveLength(1484)
  })
})
