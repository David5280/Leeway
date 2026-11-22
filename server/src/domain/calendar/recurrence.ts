// Repeating events as the days each repeat starts on, from a rule read by
// rule.ts. Works on days as written in the event's own zone; the caller moves
// them to the owner's. Each rule spends from a work budget, so no calendar
// file can keep the server busy for long. Pure.

import { fromDayNumber, toDayNumber, type IsoDate } from '../../lib/dates.js'
import {
  anchorOf,
  DAYS_OF_PERIOD,
  monthsOfYear,
  periodStart,
  periodsUntil,
  type Anchor,
  type Day,
} from './periods.js'
import type { Bounds, Frequency, Rule } from './rule.js'

/**
 * Work done for one whole file, shared by all its rules: one unit for each
 * month a period looks at (a weekly or daily period counts as one), one for
 * each day it picks, and what each repeat in the bounds costs to become an
 * event (REPEAT_UNITS). A rule is walked only across the window, or from its
 * first day when it has a COUNT that cannot be skipped, so a calendar of
 * people's lives needs a small share of this. It is the stop for a file built
 * to keep the server busy. A unit takes around half a microsecond, so the
 * whole budget is a fraction of a second.
 */
export const UNITS_PER_FILE = 200_000

/**
 * The work of turning one repeat into the days it covers, on top of finding
 * it: next to nothing for a whole day or a floating time, around a dozen
 * units' worth of time zone math for a time on a named zone's clock.
 */
export const REPEAT_UNITS = { plain: 1, zoned: 12 } as const

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
function costOfPeriod(anchor: Anchor, rule: Rule): number {
  return rule.frequency === 'YEARLY' ? monthsOfYear(anchor, rule).length : 1
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
    return perMonth === null ? null : monthsOfYear(anchor, rule).length * perMonth
  },
}

/** One period's days, the first day itself counted as the first repeat. */
function daysIn(anchor: Anchor, rule: Rule, period: number): Day[] {
  const days = DAYS_OF_PERIOD[rule.frequency](anchor, rule, period)
  const picked = period === 0 ? [...new Set([anchor.day, ...days])].sort((a, b) => a - b) : days
  return picked.filter((day) => day >= anchor.day)
}

/** Where a walk starts: the period, how many repeats come before it, and the work of finding out. */
interface Start {
  period: number
  seen: number
  units: number
}

/**
 * Where to start walking: periods long before the window are skipped rather
 * than walked. With a COUNT they can be skipped only when each period picks
 * the same number of days, counted without walking; otherwise the walk
 * starts at the first day so the count comes out right.
 */
function startOf(anchor: Anchor, rule: Rule, from: IsoDate): Start {
  // A period before the one holding `from`, so none of the days skipped is in the window.
  const ahead = Math.floor(periodsUntil(anchor, from, rule.frequency) / rule.interval) - 1
  const fromFirst = { period: 0, seen: 0, units: 0 }
  if (ahead <= 0) return fromFirst
  if (rule.count === null) return { period: ahead * rule.interval, seen: 0, units: 0 }
  const perPeriod = DAYS_PER_PERIOD[rule.frequency](anchor, rule)
  if (perPeriod === null) return fromFirst
  // The first period may pick fewer (days before the first day do not count).
  const firstDays = daysIn(anchor, rule, 0).length
  const seen = firstDays + perPeriod * (ahead - 1)
  return { period: ahead * rule.interval, seen, units: costOfPeriod(anchor, rule) + firstDays }
}

/** The last day a rule may pick: the bounds' end, or UNTIL when sooner. */
function lastDayOf(bounds: Bounds): IsoDate {
  return bounds.until && bounds.until < bounds.to ? bounds.until : bounds.to
}

/**
 * The days the event starts on within the bounds, soonest first. The first
 * day always counts as the first repeat, as the format says. The walk ends
 * at the first period starting after the bounds, so a rule that never picks
 * a day (BYMONTHDAY=30 in February) costs only the window's periods. Each
 * period walked, each day it picks and each repeat it gives (at
 * `unitsPerRepeat`) is taken from `budget`; when it runs out the rule stops
 * where it is and the budget says so.
 */
export function expandRule(
  first: IsoDate,
  rule: Rule,
  bounds: Bounds,
  budget: WorkBudget = workBudget(),
  unitsPerRepeat = 0,
): IsoDate[] {
  const anchor = anchorOf(first)
  const from = toDayNumber(bounds.from)
  const stop = toDayNumber(lastDayOf(bounds))
  const periodCost = costOfPeriod(anchor, rule)
  const start = startOf(anchor, rule, bounds.from)
  let { period, seen } = start
  const starts: IsoDate[] = []
  if (budget.unitsLeft < start.units) {
    budget.ranOut = true
    return starts
  }
  budget.unitsLeft -= start.units
  if (rule.count !== null && seen >= rule.count) return starts
  for (; periodStart(anchor, rule, period) <= stop; period += rule.interval) {
    const days = daysIn(anchor, rule, period)
    const repeats = days.filter((day) => day >= from && day <= stop).length
    const cost = periodCost + days.length + repeats * unitsPerRepeat
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

/** The most days one month of a monthly or yearly rule can pick. */
function mostDaysInMonth(rule: Rule): number {
  // BYDAY only narrows BYMONTHDAY's days; on its own, "MO" is up to five days and "2MO" one.
  if (rule.byMonthDay.length) return Math.min(31, rule.byMonthDay.length)
  if (!rule.byDay.length) return 1
  return Math.min(
    31,
    rule.byDay.reduce((sum, day) => sum + (day.nth === null ? 5 : 1), 0),
  )
}

/** The most days any one period of a rule can pick. */
const MOST_DAYS_PER_PERIOD: Record<Frequency, (anchor: Anchor, rule: Rule) => number> = {
  DAILY: () => 1,
  WEEKLY: (_, rule) => Math.max(1, new Set(rule.byDay.map((day) => day.weekday)).size),
  MONTHLY: (_, rule) => mostDaysInMonth(rule),
  YEARLY: (anchor, rule) =>
    rule.byMonth.length || rule.byMonthDay.length
      ? monthsOfYear(anchor, rule).length * mostDaysInMonth(rule)
      : 1,
}

/**
 * The most work expandRule could do for a rule: every period from where its
 * walk starts to the bounds' end, each picking as many days as a period of
 * it can, plus the first day. Never less than the work it does, and worked
 * out in a moment, so a file's rules can be expanded cheapest first.
 */
export function mostUnits(first: IsoDate, rule: Rule, bounds: Bounds, unitsPerRepeat = 0): number {
  const anchor = anchorOf(first)
  const start = startOf(anchor, rule, bounds.from)
  // The last period starting by the bounds' end: periodsUntil counts whole
  // periods from the first day's, and a week may start a day or more earlier.
  const lastPeriod = periodsUntil(anchor, lastDayOf(bounds), rule.frequency) + 1
  const walked = Math.max(0, Math.floor((lastPeriod - start.period) / rule.interval) + 1)
  const perDay = 1 + unitsPerRepeat
  const perPeriod =
    costOfPeriod(anchor, rule) + MOST_DAYS_PER_PERIOD[rule.frequency](anchor, rule) * perDay
  return start.units + walked * perPeriod + perDay
}
