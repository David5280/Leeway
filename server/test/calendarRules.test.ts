// A repeating event's rule (RRULE): how it is read, and the days it picks.

import { describe, expect, it } from 'vitest'
import { expandRule, mostUnits, workBudget } from '../src/domain/calendar/recurrence.js'
import { parseRule, type Rule } from '../src/domain/calendar/rule.js'

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
  it('reads a day, weekday or month listed more than once as one', () => {
    expect(parseRule('FREQ=MONTHLY;BYDAY=MO,MO,+1TU,1TU,TU;BYMONTHDAY=1,01,-1,1')).toMatchObject({
      byDay: [
        { weekday: 1, nth: null },
        { weekday: 2, nth: 1 },
        { weekday: 2, nth: null },
      ],
      byMonthDay: [1, -1],
    })
    expect(parseRule('FREQ=YEARLY;BYMONTH=3,3,03,9')?.byMonth).toEqual([3, 9])
    // A list written out 100,000 times over is as short as written once.
    const long = Array.from({ length: 100_000 }, () => 'MO,WE').join(',')
    expect(parseRule(`FREQ=WEEKLY;BYDAY=${long}`)?.byDay).toHaveLength(2)
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
    // Days of the month with no BYMONTH repeat every month, as RFC 5545 expands them.
    expect(expandRule('2026-03-10', rule('FREQ=YEARLY;BYMONTHDAY=1;COUNT=3'), all)).toEqual([
      '2026-03-10',
      '2026-04-01',
      '2026-05-01',
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
      ['2003-03-10', 'FREQ=YEARLY;BYMONTHDAY=10,20;COUNT=200'],
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

  it('never spends more than mostUnits says it might', () => {
    // mostUnits orders the rules sharing a file's budget, cheapest first, so it must not guess low.
    const cases: [string, string][] = [
      ['2026-01-01', 'FREQ=DAILY'],
      ['1900-01-01', 'FREQ=DAILY;BYDAY=MO;COUNT=40000'],
      ['1990-06-15', 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,FR'],
      ['2001-01-31', 'FREQ=MONTHLY;BYMONTHDAY=31,-1'],
      ['2010-01-01', 'FREQ=MONTHLY;BYDAY=-1FR,2TU'],
      ['1960-03-05', 'FREQ=YEARLY'],
      ['1980-02-29', 'FREQ=YEARLY;BYMONTHDAY=29'],
      ['2000-01-01', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'],
    ]
    const window = { from: '2023-11-01', to: '2027-11-23', until: null }
    for (const [first, text] of cases) {
      for (const unitsPerRepeat of [0, 1, 12]) {
        const budget = workBudget(10_000_000)
        expandRule(first, rule(text), window, budget, unitsPerRepeat)
        const spent = 10_000_000 - budget.unitsLeft
        expect(spent, text).toBeLessThanOrEqual(
          mostUnits(first, rule(text), window, unitsPerRepeat),
        )
      }
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
