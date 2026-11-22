// Calendar files built to keep the server busy with repeating events: the
// work budget each read has, and how it is shared among a file's rules.

import { describe, expect, it } from 'vitest'
import { REPEAT_UNITS, workBudget } from '../src/domain/calendar/recurrence.js'
import { expandAll, type RuleJob } from '../src/domain/calendar/repeatShares.js'
import { parseRule, type Rule } from '../src/domain/calendar/rule.js'
import { eventsIn, ics } from './fixtures/calendarFile.js'

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

describe('sharing the budget among many rules', () => {
  const window = { from: '2023-11-01', to: '2027-11-23' }
  const bounds = { from: '2023-11-21', to: '2027-11-24', until: null }
  /** The same twice-weekly rule, `count` times over. */
  const twiceWeekly = (count: number): RuleJob[] =>
    Array.from({ length: count }, () => ({
      first: '2023-01-02',
      rule: parseRule('FREQ=WEEKLY;BYDAY=MO,TH') as Rule,
      bounds,
      unitsPerRepeat: REPEAT_UNITS.plain,
      upfrontUnits: 0,
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
      upfrontUnits: 0,
    }
    const birthday = {
      first: '1960-03-05',
      rule: parseRule('FREQ=YEARLY') as Rule,
      bounds,
      unitsPerRepeat: 1,
      upfrontUnits: 0,
    }
    const budget = workBudget(40_000)
    const [first, second, last] = expandAll([daily, daily, birthday], budget)
    expect(last).toEqual(['2024-03-05', '2025-03-05', '2026-03-05', '2027-03-05'])
    expect([first, second]).toEqual([null, null])
    expect(budget.ranOut).toBe(true)
  })

  it('pays for a rule’s other work first, counting it toward the rule’s cost', () => {
    const birthday = (upfrontUnits: number): RuleJob => ({
      first: '1960-03-05',
      rule: parseRule('FREQ=YEARLY') as Rule,
      bounds,
      unitsPerRepeat: 1,
      upfrontUnits,
    })
    const budget = workBudget(1000)
    // The one with more to pay first is worked out last, and left out once too little is left.
    expect(expandAll([birthday(990), birthday(5)], budget)).toEqual([
      null,
      ['2024-03-05', '2025-03-05', '2026-03-05', '2027-03-05'],
    ])
    expect(budget.ranOut).toBe(true)
    expect(budget.unitsLeft).toBeGreaterThan(900)
  })

  it('leaves out the event whose skipped days cost most to place, wherever it is listed', () => {
    // 12,500 skipped moments in UTC on a New York event: 150,000 units to place, listed first.
    const skipped = Array.from({ length: 12_500 }, (_, i) => {
      const minutes = i % 1440
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`
      return `202${4 + Math.floor(i / 1440 / 366)}${String(1 + (Math.floor(i / 1440) % 12)).padStart(2, '0')}15T${time}Z`
    })
    const listed = [
      'UID:costly',
      'SUMMARY:Camping trip',
      'DTSTART;TZID=America/New_York:20240101T090000',
      'RRULE:FREQ=DAILY;COUNT=40',
      `EXDATE:${skipped.join(',')}`,
    ]
    // Forty daily trips across the window, about 3,000 units each: all fit if worked out first.
    const daily = Array.from({ length: 40 }, (_, i) => [
      `UID:daily-${i}`,
      `SUMMARY:Trip ${i}`,
      'DTSTART;VALUE=DATE:20231101',
      'RRULE:FREQ=DAILY',
    ])
    const budget = workBudget()
    const kept = new Set(
      eventsIn(ics(listed, ...daily), 'UTC', window, { budget }).map((e) => e.uid),
    )
    expect(kept.size).toBe(40)
    expect(kept.has('costly')).toBe(false)
    expect(budget.ranOut).toBe(true)
  })
})
