// One payday everywhere, checked against a plain rule written out here on
// its own: a schedule's paydays are the days it is meant to pay, from the
// one the owner gave on, each paid the business day before a weekend or a
// day the Federal Reserve is closed, and the next payday is the first paid
// after today. The owner's own pay, a paycheck budget period on its
// schedule and the forecast's paydays ahead (payday.ts) must all give that,
// every day of a year. Pure.

import { describe, expect, it } from 'vitest'
import { NO_PAY } from '../src/domain/pay/current.js'
import type { PayCadence } from '../src/domain/pay/cadence.js'
import { withOwnersPay } from '../src/domain/pay/ownPay.js'
import { paydayFrom, paydaysAhead } from '../src/domain/pay/payday.js'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import { nextOwnPayday } from '../src/domain/pay/periodPayday.js'
import { settingsSchema } from '../src/domain/settings.js'
import { addDays } from '../src/lib/dates.js'

/** Weekdays the Federal Reserve is closed, Nov 2026 to Mar 2028, from its published schedule. */
const FED_CLOSED = new Set([
  '2026-11-11',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-05-31',
  '2027-07-05',
  '2027-09-06',
  '2027-10-11',
  '2027-11-11',
  '2027-11-25',
  '2028-01-17',
  '2028-02-21',
])

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

/** The oracle's paid day: the day itself, or the last weekday before it that banks open. */
function paid(date: string): string {
  let day = date
  while (weekday(day) === 0 || weekday(day) === 6 || FED_CLOSED.has(day)) day = addDays(day, -1)
  return day
}

/** The last day of a month (1 to 12). */
const monthEnd = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

/** The 15th, or any day, of a month, written out. */
const dayOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

/** The days a schedule is meant to pay, from `first` on, through Mar 2028. */
function meantDays(cadence: PayCadence, first: string, days: number[]): string[] {
  if (cadence === 'week' || cadence === 'biweek') {
    const step = cadence === 'week' ? 7 : 14
    return Array.from({ length: 120 }, (_, i) => addDays(first, i * step)).filter(
      (day) => day < '2028-04-01',
    )
  }
  // Oct 2026 through Mar 2028, as [year, month]: month indexes count from Jan 2026.
  const months = Array.from({ length: 18 }, (_, i) => [
    2026 + Math.floor((9 + i) / 12),
    ((9 + i) % 12) + 1,
  ])
  // A 31 is each month's last day, whatever its length.
  return months
    .flatMap(([year, month]) =>
      days.map((day) => (day === 31 ? monthEnd(year!, month!) : dayOf(year!, month!, day))),
    )
    .filter((day) => day >= first)
    .sort()
}

/** The oracle: the first paid day after today. */
const oracleNext = (meant: string[], today: string) => meant.map(paid).find((day) => day > today)!

/** Every day from Nov 10, 2026, for 400 days. */
const YEAR = Array.from({ length: 400 }, (_, i) => addDays('2026-11-10', i))

/** Schedules as the owner gives them, with the days each is meant to pay. */
const SCHEDULES = [
  { cadence: 'week', nextPayday: '2026-11-19', meant: ['2026-11-19'] },
  { cadence: 'week', nextPayday: '2027-01-18', meant: ['2027-01-18'] },
  { cadence: 'biweek', nextPayday: '2026-11-27', meant: ['2026-11-27'] },
  { cadence: 'biweek', nextPayday: '2026-12-25', meant: ['2026-12-25'] },
  { cadence: 'semimonth', nextPayday: '2026-11-30', meant: ['2026-11-30', 15, 31] },
  // Friday Nov 13, paid for Sunday the 15th.
  { cadence: 'semimonth', nextPayday: '2026-11-13', meant: ['2026-11-15', 15, 31] },
  { cadence: 'semimonth', nextPayday: '2026-12-10', meant: ['2026-12-10', 10, 25] },
  { cadence: 'month', nextPayday: '2026-11-30', meant: ['2026-11-30', 31] },
  // Friday Jan 29, paid for Sunday the 31st.
  { cadence: 'month', nextPayday: '2027-01-29', meant: ['2027-01-31', 31] },
  { cadence: 'month', nextPayday: '2026-12-05', meant: ['2026-12-05', 5] },
] as const

/** The oracle's paydays for a schedule: from the day it was meant for, on its days. */
function meantFor({ cadence, meant }: (typeof SCHEDULES)[number]): string[] {
  const [first, ...days] = meant
  return meantDays(cadence, first as string, days as number[])
}

/** Settings with the owner's pay given before any of it (so none stands late), and a period. */
function settingsFor(schedule: (typeof SCHEDULES)[number], period: 'paycheck' | 'monthly') {
  const { cadence, nextPayday } = schedule
  const override = {
    cadence,
    nextPayday,
    amountCents: 100_000,
    payerId: null,
    givenOn: '2026-11-01',
  }
  const config =
    period === 'paycheck' ? paycheckPeriod(cadence, nextPayday) : { kind: 'monthly', startDay: 1 }
  return settingsSchema.parse({ period: config, pay: { override } })
}

describe('every payday, every day of a year, against the plain rule', () => {
  it.each(SCHEDULES)('$cadence from $nextPayday', (schedule) => {
    const meant = meantFor(schedule)
    const own = { ...schedule, givenOn: '2026-11-01' }
    const period = settingsFor(schedule, 'paycheck')
    for (const today of YEAR) {
      const expected = oracleNext(meant, today)
      expect([today, nextOwnPayday(own, today)]).toEqual([today, expected])
      expect([today, paydayFrom(NO_PAY, period, today).date]).toEqual([today, expected])
    }
  })
})

describe("the forecast's paydays ahead", () => {
  it.each(SCHEDULES)('are the plain rule stepped: $cadence from $nextPayday', (schedule) => {
    const meant = meantFor(schedule).map(paid)
    for (const kind of ['paycheck', 'monthly'] as const) {
      const settings = settingsFor(schedule, kind)
      for (const today of YEAR.filter((_, i) => i % 9 === 0)) {
        const to = addDays(today, 55)
        const expected = meant.filter((day) => day > today && day <= to)
        // Pay as source.ts reads it: the owner's own laid over the paychecks (none here).
        const pay = withOwnersPay(NO_PAY, settings.pay, today)
        expect([today, kind, paydaysAhead(pay, settings, today, to)]).toEqual([
          today,
          kind,
          expected,
        ])
      }
    }
  })
})
