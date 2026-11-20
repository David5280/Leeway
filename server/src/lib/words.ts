// Dates and budget periods in the words people read, shared by the dashboard
// summary, the weekly email and the web app. Pure, no I/O.

import type { IsoDate } from './dates.js'
import type { PeriodConfig } from './periods.js'

const PERIOD_WORDS: Record<PeriodConfig['kind'], string> = {
  monthly: 'month',
  paycheck: 'paycheck',
  weekly: 'week',
}

/** The everyday word for a kind of budget period: "month", "week" or "paycheck". */
export function periodWord(kind: PeriodConfig['kind']): string {
  return PERIOD_WORDS[kind]
}

/** "Nov 28", in the owner's language. Dates are calendar days, so UTC keeps the day put. */
export function shortDate(date: IsoDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

/** "Nov 19, 2026", for a day that can be a year or more back, like where history starts. */
export function longDate(date: IsoDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}
