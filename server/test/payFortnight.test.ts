// Every two weeks against twice a month, and the next payday each projects
// (domain/pay/fortnight.ts, nominal.ts and cadence.ts): no twice-a-month
// payroll is ever confirmed as every two weeks, nor the other way round,
// on any schedule of two days, through holidays and weekends moved either
// way; a payday already moved is never counted from; and what is read as
// either never projects a payday ahead of the real one. Every date is made
// up; the holidays are real (fixtures/paydays.ts).

import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, dayOfWeek, type IsoDate } from '../src/lib/dates.js'
import {
  laterNextPayday,
  nextPaydayAfter,
  payPattern,
  type PayPattern,
} from '../src/domain/pay/cadence.js'
import { CONFIRM_FROM } from '../src/domain/pay/fortnight.js'
import {
  businessDayOnOrAfter,
  businessDayOnOrBefore,
  MONTH_END,
  type SemimonthSchedule,
} from '../src/domain/pay/semimonthly.js'
import {
  biweeklyPaid,
  paidOnBusinessDay,
  paidOnBusinessDayAfter,
  semimonthlyPaid,
} from './fixtures/paydays.js'

/** Sweeps read thousands of runs, longer than a test is given by default. */
const SWEEP_TIMEOUT = 60_000

const BIWEEKLY: PayPattern = { cadence: 'biweek', schedule: null, ambiguous: false }

/** One letter a reading: S twice a month, B every two weeks, a either. */
function letter(pattern: PayPattern | null): string {
  if (!pattern) return '-'
  if (pattern.cadence === 'semimonth') return 'S'
  return pattern.ambiguous ? 'a' : 'B'
}

/** The reading of each run of paydays from the first: the first two, the first three, and on. */
const readings = (paid: IsoDate[]) =>
  paid
    .slice(1)
    .map((_, i) => letter(payPattern(paid.slice(0, i + 2))))
    .join('')

/** The next payday the app shows for paydays, as pay/current.ts reads them. */
function shownNext(paid: IsoDate[], today: IsoDate): IsoDate {
  const pattern = payPattern(paid)!
  if (pattern.ambiguous) return laterNextPayday(paid, today, pattern.schedule!)
  return nextPaydayAfter(paid, pattern.cadence, today, pattern.schedule ?? undefined)
}

/** Every schedule of two days 1 to 28, 13 to 17 days apart, and the month's end after the 13th to 16th. */
function everySchedule(): SemimonthSchedule[] {
  const schedules: SemimonthSchedule[] = []
  for (let first = 1; first <= 15; first += 1) {
    for (let gap = 13; gap <= 17 && first + gap <= 28; gap += 1) {
      schedules.push({ first, second: first + gap })
    }
  }
  for (const first of [13, 14, 15, 16]) schedules.push({ first, second: MONTH_END })
  return schedules
}

/** Runs to sweep: from a spread of months and halves, 2023 through 2026. */
const STARTS: [number, number, 0 | 1][] = [
  [2023, 1, 0],
  [2023, 5, 1],
  [2023, 11, 0],
  [2024, 2, 1],
  [2024, 8, 0],
  [2024, 12, 1],
  [2025, 4, 0],
  [2025, 9, 1],
  [2026, 6, 0],
  [2026, 12, 1],
]

describe('twice-a-month payrolls a 14-day grid also fits', () => {
  it('reads them as either, not confirmed, and shows the later next payday', () => {
    const cases: [IsoDate[], IsoDate][] = [
      // The 5th and the 20th, paid the business day before a weekend: the 20th of March is next.
      [['2023-01-05', '2023-01-20', '2023-02-03', '2023-02-17', '2023-03-03'], '2023-03-20'],
      // The 1st and the 15th, paid the business day after: Monday Apr 3 for Saturday Apr 1.
      [
        ['2023-01-03', '2023-01-17', '2023-02-01', '2023-02-15', '2023-03-01', '2023-03-15'],
        '2023-04-03',
      ],
      // The 1st and the 15th around New Year's Day and MLK Day: Feb 1, not Jan 26.
      [['2023-12-01', '2023-12-15', '2023-12-29', '2024-01-12'], '2024-02-01'],
    ]
    for (const [paid, next] of cases) {
      expect(payPattern(paid)).toMatchObject({ cadence: 'biweek', ambiguous: true })
      expect(shownNext(paid, addDays(paid.at(-1)!, 1))).toBe(next)
    }
  })

  it('takes the later of two schedules the paydays fit alike', () => {
    // The 7th and the 22nd: Fridays Feb 21 and Mar 21 fit the 23rd as well, so Apr 23, a day late, never early.
    const paid = ['2025-02-07', '2025-02-21', '2025-03-07', '2025-03-21', '2025-04-07']
    expect(payPattern(paid)).toEqual({
      cadence: 'biweek',
      schedule: { first: 7, second: 23 },
      ambiguous: true,
    })
    expect(shownNext(paid, '2025-04-08')).toBe('2025-04-23')
  })

  it('never confirms every two weeks before the fourth payday', () => {
    expect(CONFIRM_FROM).toBe(4)
    // Fridays from Sep 18 sit up to three days off the 15th and the month's end: settled at the fifth.
    expect(readings(biweeklyPaid('2026-09-18', 6))).toBe('aaaBB')
  })
})

describe('a semimonthly payday already paid early', () => {
  it('counts on from the schedule day it was meant for, never pays it again', () => {
    const fifteenthAndEnd = { first: 15, second: MONTH_END }
    // Friday Jan 12 was the 15th's, paid early for MLK Day: Jan 31 is next.
    expect(
      nextPaydayAfter(['2023-12-29', '2024-01-12'], 'semimonth', '2024-01-13', fifteenthAndEnd),
    ).toBe('2024-01-31')
    const firstAndFifteenth = { first: 1, second: 15 }
    // Thursday Dec 31 was the 1st's, paid early for New Year's Day: Jan 15 is next.
    expect(
      nextPaydayAfter(['2026-12-15', '2026-12-31'], 'semimonth', '2027-01-01', firstAndFifteenth),
    ).toBe('2027-01-15')
    // Holidays are not known here: Monday Jan 15 2024, MLK Day, is projected as open.
    expect(
      nextPaydayAfter(['2023-12-15', '2023-12-29'], 'semimonth', '2023-12-30', firstAndFifteenth),
    ).toBe('2024-01-15')
    // Thursday Nov 9 was the 10th's, paid early for Veterans Day: Friday Nov 24 for Saturday the 25th.
    expect(
      nextPaydayAfter(['2023-10-25', '2023-11-09'], 'semimonth', '2023-11-10', {
        first: 10,
        second: 25,
      }),
    ).toBe('2023-11-24')
  })

  it('moves weekend paydays the way the paydays show', () => {
    const firstAndFifteenth = { first: 1, second: 15 }
    // Monday Jan 17 for Sunday the 15th: this payroll pays after, so Saturday Apr 1 is Monday Apr 3.
    const after = ['2023-01-17', '2023-02-01', '2023-02-15', '2023-03-01', '2023-03-15']
    expect(nextPaydayAfter(after, 'semimonth', '2023-03-16', firstAndFifteenth)).toBe('2023-04-03')
    // With no weekend payday seen yet, the business day before, as most payrolls pay.
    const unseen = ['2023-02-01', '2023-02-15', '2023-03-01', '2023-03-15']
    expect(nextPaydayAfter(unseen, 'semimonth', '2023-03-16', firstAndFifteenth)).toBe('2023-03-31')
    // Read as either, it takes the business day after, which is never early.
    expect(laterNextPayday(unseen, '2023-03-16', firstAndFifteenth)).toBe('2023-04-03')
  })
})

describe('the day a monthly payroll keeps', () => {
  it('reads a last business day as the month end, even paid early twice', () => {
    const monthEnd = [
      '2027-05-28',
      '2027-06-30',
      '2027-07-30',
      '2027-08-31',
      '2027-09-30',
      '2027-10-29',
      '2027-11-30',
      '2027-12-30',
    ]
    expect(nextPaydayAfter(monthEnd, 'month', '2027-12-31')).toBe('2028-01-31')
    // Without a 31st paid yet, the 30th fits as well: the month's end is the later.
    expect(nextPaydayAfter(monthEnd.slice(4), 'month', '2027-12-31')).toBe('2028-01-31')
  })

  it('reads the 1st paid early, and a 15th on two weekends, as those days', () => {
    // Thursday Dec 31 for New Year's Day: the 1st, so Monday Feb 1.
    expect(nextPaydayAfter(['2026-12-01', '2026-12-31'], 'month', '2027-01-01')).toBe('2027-02-01')
    // Fridays Feb 13 and Mar 13, each for a Sunday the 15th: Wednesday Apr 15.
    expect(nextPaydayAfter(['2026-02-13', '2026-03-13'], 'month', '2026-03-14')).toBe('2026-04-15')
  })

  it('moves a weekend payday after for a payroll whose paydays show it does', () => {
    // The 5th, paid on the Monday after for Sunday Feb 5 and Sunday Mar 5: Saturday Aug 5 is Monday Aug 7.
    const fifth = ['2023-01-05', '2023-02-06', '2023-03-06', '2023-04-05', '2023-05-05']
    expect(nextPaydayAfter(fifth, 'month', '2023-07-06')).toBe('2023-08-07')
  })
})

describe('a biweekly run with one payday well off its grid', () => {
  it('keeps every two weeks through a posting two business days late', () => {
    const late = [
      '2024-01-05',
      '2024-01-23',
      '2024-02-02',
      '2024-02-16',
      '2024-03-01',
      '2024-03-15',
      '2024-03-29',
      '2024-04-12',
    ]
    expect(payPattern(late)).toEqual(BIWEEKLY)
    expect(nextPaydayAfter(late, 'biweek', '2024-04-13')).toBe('2024-04-26')
    // With the late one newest, the next is still counted from its Friday.
    const lateNewest = ['2024-03-01', '2024-03-15', '2024-03-29', '2024-04-16']
    expect(nextPaydayAfter(lateNewest, 'biweek', '2024-04-17')).toBe('2024-04-26')
  })

  /** Runs of 4, 6 and 10 from `base`, each with one payday moved 2 days early or 2 or 3 late. */
  function withOneStray(base: IsoDate[]): IsoDate[][] {
    return [4, 6, 10].flatMap((count) =>
      base.slice(0, count).flatMap((date, stray) =>
        [-2, 2, 3].map((days) => {
          const run = base.slice(0, count)
          run[stray] = addDays(date, days)
          return run
        }),
      ),
    )
  }

  it(
    'never reads one stray, late or early, as twice a month',
    () => {
      const misread: string[] = []
      for (let start = '2024-01-01'; start < '2026-12-01'; start = addDays(start, 9)) {
        if (dayOfWeek(start) === 0 || dayOfWeek(start) === 6) continue
        for (const run of withOneStray(biweeklyPaid(start, 10))) {
          if (payPattern(run)?.cadence === 'semimonth') misread.push(run.join(','))
        }
      }
      expect(misread).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('reads afresh, as either, once a second payday leaves the grid', () => {
    // Eight Fridays, then the payroll moves to Tuesdays.
    const fridays = biweeklyPaid('2026-03-06', 8)
    const moved = [1, 2, 3].map((k) => addDays(fridays.at(-1)!, 14 * k + 4))
    expect(readings([...fridays, ...moved])).toBe('aaaBBBBBaa')
  })
})

/** Days early a settled reading may show: three before a payroll paying after is seen, else one. */
const unseenAllowance = (unseen: boolean) => (unseen ? 3 : 1)

describe('a sweep of every twice-a-month schedule', () => {
  /** For runs of `count` on every schedule from every start, moved by `pay`, what fails `check`. */
  function sweep(
    pay: (date: IsoDate) => IsoDate,
    count: number,
    check: (
      paid: IsoDate[],
      schedule: SemimonthSchedule,
      start: [number, number, 0 | 1],
    ) => string | null,
  ): string[] {
    const failed: string[] = []
    for (const schedule of everySchedule()) {
      for (const start of STARTS) {
        const failure = check(semimonthlyPaid(schedule, start, count, pay), schedule, start)
        if (failure) failed.push(`${schedule.first}/${schedule.second} ${failure}`)
      }
    }
    return failed
  }

  it(
    'never confirms every two weeks, and settles by the eighth payday for good',
    () => {
      // Through holidays, paid the business day before; moved after, holidays aside.
      for (const pay of [paidOnBusinessDay, businessDayOnOrAfter]) {
        const failed = sweep(pay, 12, (paid) => {
          const read = readings(paid)
          return /B/.test(read) || !/^[a-]{0,6}S+$/.test(read) ? `${read} ${paid.join(',')}` : null
        })
        expect(failed).toEqual([])
      }
    },
    SWEEP_TIMEOUT,
  )

  it(
    'never confirms every two weeks with holidays moved after either',
    () => {
      const failed = sweep(paidOnBusinessDayAfter, 12, (paid) =>
        /B/.test(readings(paid)) ? paid.join(',') : null,
      )
      expect(failed).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it(
    'never shows a payday early while read as either, and at most a day once settled',
    () => {
      for (const pay of [businessDayOnOrBefore, businessDayOnOrAfter]) {
        const failed = sweep(pay, 10, (paid) => {
          for (let n = 2; n < paid.length; n += 1) {
            const run = paid.slice(0, n)
            const pattern = payPattern(run)
            // Gaps too long for two weeks, as weekends can stretch them, read as no cadence (paychecks.ts).
            if (!pattern) continue
            const early = daysBetween(shownNext(run, paid[n - 1]!), paid[n]!)
            // Before a weekend payday shows a payroll paying after, it is taken to pay before.
            const unseen = pay === businessDayOnOrAfter && run.every((date, i) => date === paid[i])
            const allowed = pattern.ambiguous ? 0 : unseenAllowance(unseen)
            if (early > allowed)
              return `${letter(pattern)} ${run.join(',')} shows ${shownNext(run, paid[n - 1]!)}`
          }
          return null
        })
        expect(failed).toEqual([])
      }
    },
    SWEEP_TIMEOUT,
  )
})

/** What goes wrong for a biweekly payroll due every 14 days from `start` and paid by `pay`. */
function biweeklyFailures(start: IsoDate, pay: (date: IsoDate) => IsoDate): string[] {
  const failed: string[] = []
  const due = Array.from({ length: 13 }, (_, i) => addDays(start, 14 * i))
  const paid = due.map(pay)
  const read = readings(paid.slice(0, 12))
  if (!/^a{1,6}B+$/.test(read)) failed.push(`${read} ${paid.join(',')}`)
  for (let n = 2; n < 12; n += 1) {
    // Against the day it was due: a holiday is not known ahead.
    const next = shownNext(paid.slice(0, n), paid[n - 1]!)
    if (next < due[n]!) failed.push(`${paid.slice(0, n).join(',')} shows ${next}`)
  }
  return failed
}

describe('a sweep of biweekly payrolls through holidays', () => {
  it(
    'never reads twice a month, confirms by the eighth payday for good, and never shows a payday early',
    () => {
      const failed: string[] = []
      for (let start = '2023-01-02'; start <= '2026-12-31'; start = addDays(start, 3)) {
        if (dayOfWeek(start) === 0 || dayOfWeek(start) === 6) continue
        for (const pay of [paidOnBusinessDay, paidOnBusinessDayAfter]) {
          failed.push(...biweeklyFailures(start, pay))
        }
      }
      expect(failed).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('keeps a Monday payroll paid early for holidays confirmed from paycheck 8 to 10', () => {
    // MLK Day, Presidents Day and Memorial Day each pay the Friday before.
    const mondays = biweeklyPaid('2027-01-04', 12)
    expect(mondays.filter((date) => dayOfWeek(date) === 5).length).toBeGreaterThan(0)
    expect(readings(mondays).slice(6)).toBe('BBBBB')
  })
})
