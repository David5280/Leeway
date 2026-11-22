// Calendar files built, or grown big enough, to keep the server busy: the
// work budget, how it is shared among rules, and how quickly files read.

import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Keep } from '../src/domain/calendar/ics.js'
import { kindOf, mayHaveKind } from '../src/domain/calendar/kinds.js'
import { REPEAT_UNITS, workBudget } from '../src/domain/calendar/recurrence.js'
import { expandAll, type RuleJob } from '../src/domain/calendar/repeatShares.js'
import { parseRule, type Rule } from '../src/domain/calendar/rule.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

/**
 * How long these may take. Each runs in a fraction of this on a laptop; the
 * bound is loose so a slow CI machine never fails it, yet tight enough that
 * the seconds-long reads these guard against always would.
 */
const QUICK_MS = 1000

/** The events likely to cost money, as a calendar read keeps them. */
const LIKELY_TO_COST: Keep = {
  mayKeep: mayHaveKind,
  keeps: (event: CalendarEvent) => kindOf(event) !== null,
}

/** How long `work` takes, in milliseconds. */
function timed(work: () => void): number {
  const started = performance.now()
  work()
  return performance.now() - started
}

/** A calendar day `i` days after 2016-01-01, as an .ics date. */
function icsDay(i: number): string {
  return new Date(Date.UTC(2016, 0, 1) + i * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '')
}

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
    expect(eventsIn(text, 'UTC', window, { budget })).toEqual([])
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
    expect(eventsIn(ics(...counted), 'UTC', window, { budget })).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
    expect(budget).toMatchObject({ ranOut: false })
    expect(workBudget().unitsLeft - budget.unitsLeft).toBeLessThanOrEqual(25 * 2)
  })

  it('leaves out only the costliest rules, within a fraction of a second', () => {
    // Every Monday for 40,000 Mondays from 1900: walked day by day, far past what is cheap.
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
    const events = eventsIn(text, 'UTC', window, { budget })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(budget.ranOut).toBe(true)
    expect(budget.unitsLeft).toBeGreaterThanOrEqual(0)
    // The birthday listed after them is kept, every year of the window.
    const cheap = events.filter((event) => !event.uid.startsWith('greedy'))
    expect(cheap.map((event) => [event.uid, event.startsOn])).toEqual([
      ['mom', '2024-03-01'],
      ['mom', '2025-03-01'],
      ['mom', '2026-03-01'],
      ['rome', '2026-12-10'],
      ['mom', '2027-03-01'],
    ])
    // As many greedy rules as the budget holds are kept whole; the rest are left out.
    const greedyKept = new Set(
      events.map((event) => event.uid).filter((uid) => uid.startsWith('greedy')),
    )
    expect(greedyKept.size).toBeGreaterThan(1)
    expect(greedyKept.size).toBeLessThan(25)
  })

  it.each([
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=40000',
    'FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=40000',
    'FREQ=WEEKLY;BYMONTH=1;COUNT=40000',
    'FREQ=DAILY;BYMONTHDAY=-1;COUNT=40000',
  ])('stops %s from a century ago within a fraction of a second', (rule) => {
    // Rules whose count cannot be skipped, each made to cost the most per period it can.
    const costly = Array.from({ length: 40 }, (_, i) => [
      `UID:costly-${i}`,
      `SUMMARY:Camp ${i}`,
      'DTSTART;VALUE=DATE:19000101',
      `RRULE:${rule}`,
    ])
    const budget = workBudget()
    const started = performance.now()
    eventsIn(ics(...costly), 'UTC', window, { budget })
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
    const events = eventsIn(ics(daily(1), daily(2)), 'UTC', window, { budget })
    expect(budget.ranOut).toBe(false)
    expect(events.filter((event) => event.uid === 'daily-2')).toHaveLength(1484)
  })
})

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

describe('sharing the budget among many rules', () => {
  const bounds = { from: '2023-11-21', to: '2027-11-24', until: null }
  /** The same twice-weekly rule, `count` times over. */
  const twiceWeekly = (count: number): RuleJob[] =>
    Array.from({ length: count }, () => ({
      first: '2023-01-02',
      rule: parseRule('FREQ=WEEKLY;BYDAY=MO,TH') as Rule,
      bounds,
      unitsPerRepeat: REPEAT_UNITS.plain,
    }))

  it('keeps every rule the budget can hold', () => {
    const budget = workBudget(200_000)
    const results = expandAll(twiceWeekly(150), budget)
    expect(results.every((days) => days !== null && days.length > 0)).toBe(true)
    expect(budget.ranOut).toBe(false)
  })

  it('keeps as many rules as fit once there are too many, rather than none', () => {
    // Each needs about 1,050 units, so 200,000 holds 190 of 200. An even share each held none.
    const budget = workBudget(200_000)
    const results = expandAll(twiceWeekly(200), budget)
    const kept = results.filter((days) => days !== null).length
    expect(kept).toBeGreaterThan(180)
    expect(kept).toBeLessThan(200)
    expect(budget.ranOut).toBe(true)
  })

  it('works out the cheapest rules first, wherever they are listed', () => {
    const daily = {
      first: '1900-01-01',
      rule: parseRule('FREQ=DAILY;BYDAY=MO;COUNT=40000') as Rule,
      bounds,
      unitsPerRepeat: 1,
    }
    const birthday = {
      first: '1960-03-05',
      rule: parseRule('FREQ=YEARLY') as Rule,
      bounds,
      unitsPerRepeat: 1,
    }
    const budget = workBudget(40_000)
    const [first, second, last] = expandAll([daily, daily, birthday], budget)
    expect(last).toEqual(['2024-03-05', '2025-03-05', '2026-03-05', '2027-03-05'])
    expect([first, second]).toEqual([null, null])
    expect(budget.ranOut).toBe(true)
  })
})
