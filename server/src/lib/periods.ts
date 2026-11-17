import {
  addDays,
  addMonths,
  clampedDate,
  dateParts,
  dayOfWeek,
  daysBetween,
  toDayNumber,
  type IsoDate,
} from './dates.js'

/**
 * How the budget is sliced into periods. People budget by the calendar month
 * (optionally starting on a day other than the 1st), by the week, or from one
 * paycheck to the next.
 */
export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

export type PeriodConfig =
  | { kind: 'monthly'; startDay: number }
  | { kind: 'weekly'; weekStartsOn: number }
  | {
      kind: 'paycheck'
      frequency: PayFrequency
      /** Any past or future payday. Weekly, biweekly and monthly pay count from it. */
      anchorDate: IsoDate
      /** The two paydays of a semimonthly schedule; 31 means the last day of the month. */
      semimonthlyDays: [number, number]
    }

/** A budget period. `end` is exclusive, so the last day is the day before it. */
export interface Period {
  start: IsoDate
  end: IsoDate
  days: number
}

function period(start: IsoDate, end: IsoDate): Period {
  return { start, end, days: daysBetween(start, end) }
}

function monthlyFrom(date: IsoDate, startDay: number): Period {
  const { year, month } = dateParts(date)
  let start = clampedDate(year, month, startDay)
  if (date < start) start = clampedDate(year, month - 1, startDay)
  const { year: sy, month: sm } = dateParts(start)
  return period(start, clampedDate(sy, sm + 1, startDay))
}

function steppedFrom(date: IsoDate, anchor: IsoDate, stepDays: number): Period {
  const steps = Math.floor((toDayNumber(date) - toDayNumber(anchor)) / stepDays)
  const start = addDays(anchor, steps * stepDays)
  return period(start, addDays(start, stepDays))
}

function semimonthlyFrom(date: IsoDate, days: [number, number]): Period {
  const [first, second] = [Math.min(...days), Math.max(...days)]
  const { year, month } = dateParts(date)
  const firstThisMonth = clampedDate(year, month, first)
  const secondThisMonth = clampedDate(year, month, second)
  if (date >= secondThisMonth) {
    return period(secondThisMonth, clampedDate(year, month + 1, first))
  }
  if (date >= firstThisMonth) return period(firstThisMonth, secondThisMonth)
  return period(clampedDate(year, month - 1, second), firstThisMonth)
}

/** The period that contains `date`. */
export function periodContaining(date: IsoDate, config: PeriodConfig): Period {
  switch (config.kind) {
    case 'monthly':
      return monthlyFrom(date, config.startDay)
    case 'weekly': {
      const back = (dayOfWeek(date) - config.weekStartsOn + 7) % 7
      const start = addDays(date, -back)
      return period(start, addDays(start, 7))
    }
    case 'paycheck':
      switch (config.frequency) {
        case 'weekly':
          return steppedFrom(date, config.anchorDate, 7)
        case 'biweekly':
          return steppedFrom(date, config.anchorDate, 14)
        case 'monthly':
          return monthlyFrom(date, dateParts(config.anchorDate).day)
        case 'semimonthly':
          return semimonthlyFrom(date, config.semimonthlyDays)
      }
  }
}

/** The period `offset` steps away: -1 is the previous period, 1 the next. */
export function shiftPeriod(current: Period, offset: number, config: PeriodConfig): Period {
  let result = current
  for (let i = 0; i < Math.abs(offset); i++) {
    result =
      offset > 0
        ? periodContaining(result.end, config)
        : periodContaining(addDays(result.start, -1), config)
  }
  return result
}

/**
 * A budget amount is entered for a cadence ("$600 a month", "$150 a week").
 * Converting through a yearly figure lets any cadence feed any period type.
 */
export type Cadence = 'week' | 'biweek' | 'semimonth' | 'month' | 'year'

const DAYS_PER_YEAR = 365.25

export const PER_YEAR: Record<Cadence, number> = {
  week: DAYS_PER_YEAR / 7,
  biweek: DAYS_PER_YEAR / 14,
  semimonth: 24,
  month: 12,
  year: 1,
}

/** The cadence that matches one period of this config exactly. */
export function cadenceOf(config: PeriodConfig): Cadence {
  if (config.kind === 'monthly') return 'month'
  if (config.kind === 'weekly') return 'week'
  return { weekly: 'week', biweekly: 'biweek', semimonthly: 'semimonth', monthly: 'month' }[
    config.frequency
  ] as Cadence
}

/** Converts an amount in cents from one cadence to another, rounded to the cent. */
export function convertCadence(cents: number, from: Cadence, to: Cadence): number {
  if (from === to) return cents
  return Math.round((cents * PER_YEAR[from]) / PER_YEAR[to])
}

/** Moves a date forward by whole cadences, for things like a bill's next due date. */
export function addCadence(
  date: IsoDate,
  cadence: Cadence,
  count = 1,
  dayOfMonth?: number,
): IsoDate {
  switch (cadence) {
    case 'week':
      return addDays(date, 7 * count)
    case 'biweek':
      return addDays(date, 14 * count)
    case 'month':
      return addMonths(date, count, dayOfMonth)
    case 'year':
      return addMonths(date, 12 * count, dayOfMonth)
    case 'semimonth': {
      // Alternate between the date's day and 15 days later, kept inside the month.
      let result = date
      for (let i = 0; i < count; i++) {
        const { day } = dateParts(result)
        result = day <= 15 ? addDays(result, 15) : addMonths(addDays(result, -15), 1)
      }
      return result
    }
  }
}
