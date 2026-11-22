// Repeating events as the days each repeat starts on, from a rule read by
// rule.ts. Works on days as written in the event's own zone; the caller moves
// them to the owner's. Each rule spends from a work budget, so no calendar
// file can keep the server busy for long. Pure.

import { fromDayNumber, toDayNumber, type IsoDate } from '../../lib/dates.js'
import {
  anchorOf,
  DAYS_OF_PERIOD,
  periodStart,
  periodsUntil,
  type Anchor,
  type Day,
} from './periods.js'
import type { Bounds, Frequency, Rule } from './rule.js'

/**
 * Work done for one whole file, shared by all its rules: one unit for each
 * month a period looks at (a weekly or daily period counts as one) and one
 * for each day it picks. A rule is walked only across the window, or from its
 * first day when it has a COUNT that cannot be skipped, so a calendar of
 * people's lives needs a small share of this: a daily rule across the window
 * is about 3,000. It is the stop for a file built to keep the server busy. A
 * unit takes around a microsecond, so the whole budget is a fraction of a second.
 */
export const UNITS_PER_FILE = 200_000

/** What is left of the work a rule, or a file's rules, may still do. */
export interface WorkBudget {
  unitsLeft: number
  /** True once a rule was cut short for want of work: its repeats are incomplete. */
  ranOut: boolean
}

export function workBudget(units = UNITS_PER_FILE): WorkBudget {
  return { unitsLeft: units, ranOut: false }
}

/** The work of looking at one period of the rule: a yearly one looks at each of its months. */
function costOfPeriod(rule: Rule): number {
  return rule.frequency === 'YEARLY' ? Math.max(1, rule.byMonth.length) : 1
}

/**
 * How many days a monthly or yearly rule picks in each month it looks at,
 * when that never varies: its days of the month (or the first day's), with
 * no BYDAY, and all of them days every month has. Null otherwise.
 */
function sameDaysEachMonth(anchor: Anchor, rule: Rule): number | null {
  if (rule.byDay.length) return null
  const days = rule.byMonthDay.length ? rule.byMonthDay : [anchor.date]
  return days.every((day) => day >= 1 && day <= 28) ? new Set(days).size : null
}

/**
 * How many days every period after the first picks, when it is always the
 * same, so a COUNT can be counted without walking: a plain daily rule picks
 * one a day, a weekly one its weekdays, a monthly or yearly one its days of
 * the month when every month has them. Null when it varies (BYDAY in a month,
 * a 31st, BYMONTH narrowing a daily or weekly rule).
 */
const DAYS_PER_PERIOD: Record<Frequency, (anchor: Anchor, rule: Rule) => number | null> = {
  DAILY: (_, rule) =>
    rule.byMonth.length || rule.byMonthDay.length || rule.byDay.length ? null : 1,
  WEEKLY: (_, rule) =>
    rule.byMonth.length ? null : new Set(rule.byDay.map((d) => d.weekday)).size || 1,
  MONTHLY: (anchor, rule) => (rule.byMonth.length ? null : sameDaysEachMonth(anchor, rule)),
  YEARLY: (anchor, rule) => {
    // Without BYMONTH or BYMONTHDAY a yearly rule keeps its day, Feb 29 on the 28th.
    if (!rule.byMonth.length && !rule.byMonthDay.length) return 1
    const perMonth = sameDaysEachMonth(anchor, rule)
    // Without BYMONTH, only the first day's month.
    return perMonth === null ? null : (new Set(rule.byMonth).size || 1) * perMonth
  },
}

/** One period's days, the first day itself counted as the first repeat. */
function daysIn(anchor: Anchor, rule: Rule, period: number): Day[] {
  const days = DAYS_OF_PERIOD[rule.frequency](anchor, rule, period)
  const picked = period === 0 ? [...new Set([anchor.day, ...days])].sort((a, b) => a - b) : days
  return picked.filter((day) => day >= anchor.day)
}

/** Where a walk starts: the period, and how many repeats come before it. */
interface Start {
  period: number
  seen: number
}

/**
 * Where to start walking: periods long before the window are skipped rather
 * than walked. With a COUNT they can be skipped only when each period picks
 * the same number of days, counted without walking; otherwise the walk
 * starts at the first day so the count comes out right.
 */
function startOf(anchor: Anchor, rule: Rule, from: IsoDate, budget: WorkBudget): Start {
  // A period before the one holding `from`, so none of the days skipped is in the window.
  const ahead = Math.floor(periodsUntil(anchor, from, rule.frequency) / rule.interval) - 1
  if (ahead <= 0) return { period: 0, seen: 0 }
  if (rule.count === null) return { period: ahead * rule.interval, seen: 0 }
  const perPeriod = DAYS_PER_PERIOD[rule.frequency](anchor, rule)
  if (perPeriod === null) return { period: 0, seen: 0 }
  // The first period may pick fewer (days before the first day do not count).
  const firstDays = daysIn(anchor, rule, 0).length
  budget.unitsLeft -= costOfPeriod(rule) + firstDays
  const seen = firstDays + perPeriod * (ahead - 1)
  return { period: ahead * rule.interval, seen }
}

/**
 * The days the event starts on within the bounds, soonest first. The first
 * day always counts as the first repeat, as the format says. The walk ends
 * at the first period starting after the bounds, so a rule that never picks
 * a day (BYMONTHDAY=30 in February) costs only the window's periods. Each
 * period walked, and each day it picks, is taken from `budget`; when it runs
 * out the rule stops where it is and the budget says so.
 */
export function expandRule(
  first: IsoDate,
  rule: Rule,
  bounds: Bounds,
  budget: WorkBudget = workBudget(),
): IsoDate[] {
  const anchor = anchorOf(first)
  const from = toDayNumber(bounds.from)
  const stop = toDayNumber(bounds.until && bounds.until < bounds.to ? bounds.until : bounds.to)
  let { period, seen } = startOf(anchor, rule, bounds.from, budget)
  const starts: IsoDate[] = []
  if (rule.count !== null && seen >= rule.count) return starts
  for (; periodStart(anchor, rule, period) <= stop; period += rule.interval) {
    const days = daysIn(anchor, rule, period)
    const cost = costOfPeriod(rule) + days.length
    if (budget.unitsLeft < cost) {
      budget.ranOut = true
      return starts
    }
    budget.unitsLeft -= cost
    for (const day of days) {
      if (day > stop) return starts
      seen++
      if (day >= from) starts.push(fromDayNumber(day))
      if (seen === rule.count) return starts
    }
  }
  return starts
}
