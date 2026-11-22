// Reads an iCalendar (.ics) file into events: what each is called, where, and
// which days it covers in the owner's time zone. Only what a money forecast
// needs is read. A repeating event is expanded across the window asked for
// (recurrence.ts), less the days it skips (EXDATE) and the repeats changed on
// their own (RECURRENCE-ID), which replace the repeat or, when cancelled,
// remove it. Working out repeats draws on one budget per file, shared among
// its rules (repeatShares.ts), so no file can keep the server busy. Pure.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'
import {
  componentsOf,
  first,
  isCancelled,
  textOf,
  uidOf,
  type Component,
  type Property,
} from './components.js'
import {
  dateIn,
  daysCovered,
  lengthOf,
  momentOf,
  onDate,
  timelineMs,
  type Moment,
} from './moments.js'
import { workBudget, type WorkBudget } from './recurrence.js'
import { expandAll, type RuleJob } from './repeatShares.js'
import { parseRule, type Bounds } from './rule.js'

export interface CalendarEvent {
  /** The calendar's own id for the event; a repeat shares it, told apart by its start. */
  uid: string
  startsOn: IsoDate
  /** The last day it covers, inclusive. */
  endsOn: IsoDate
  title: string
  location: string | null
  allDay: boolean
}

/** The days events are kept for, inclusive. */
export interface Window {
  from: IsoDate
  to: IsoDate
}

/** Which events to keep, asked of each event once, before its repeats are worked out. */
export type Keep = (event: CalendarEvent) => boolean

/** The most events kept from one file, so a huge calendar stays small to store. */
export const MAX_EVENTS = 5000

function momentOfProperty(property: Property | undefined): Moment | null {
  return property ? momentOf(property.value, property.params.TZID) : null
}

/** What every repeat of an event shares. */
interface Base {
  uid: string
  title: string
  location: string | null
  start: Moment
  lengthMs: number
}

function baseOf(component: Component, uid: string): Base | null {
  const start = momentOfProperty(first(component, 'DTSTART'))
  if (!start) return null
  const end = momentOfProperty(first(component, 'DTEND'))
  return {
    uid,
    title: textOf(first(component, 'SUMMARY')?.value) ?? 'Untitled event',
    location: textOf(first(component, 'LOCATION')?.value),
    start,
    lengthMs: lengthOf(start, end, first(component, 'DURATION')?.value),
  }
}

/** The repeat starting on `date` (as written in the event's zone), on the owner's days. */
function occurrence(base: Base, date: IsoDate, timeZone: string): CalendarEvent {
  const days = daysCovered(onDate(base.start, date), base.lengthMs, timeZone)
  return {
    uid: base.uid,
    ...days,
    title: base.title,
    location: base.location,
    allDay: base.start.seconds === null,
  }
}

/** The days, in the event's zone, its repeats are skipped on or replaced from. */
function skippedDays(master: Component, zone: string | null, overrides: Component[]): Set<IsoDate> {
  const skipped = new Set<IsoDate>()
  for (const exdate of master.get('EXDATE') ?? []) {
    for (const value of exdate.value.split(',')) {
      const moment = momentOf(value, exdate.params.TZID)
      if (moment) skipped.add(dateIn(moment, zone))
    }
  }
  for (const override of overrides) {
    const original = momentOfProperty(first(override, 'RECURRENCE-ID'))
    if (original) skipped.add(dateIn(original, zone))
  }
  return skipped
}

/**
 * True when a repeat starting on `date` is not after UNTIL. An UNTIL with a
 * time is an instant, so a repeat later that day is past it; a whole-day
 * event, or a whole-day UNTIL, is compared by day, as expandRule already did.
 */
function beforeUntil(base: Base, until: Moment | null, date: IsoDate): boolean {
  if (!until || until.seconds === null || base.start.seconds === null) return true
  return timelineMs(onDate(base.start, date)) <= timelineMs(until)
}

/** The days a rule is asked for: near the window, and none after UNTIL. */
function boundsOf(base: Base, until: Moment | null, window: Window): Bounds {
  // A day's slack either side, as the event's zone and the owner's may differ by one.
  const spanDays = Math.ceil(base.lengthMs / DAY_MS) + 1
  return {
    from: addDays(window.from, -spanDays),
    to: addDays(window.to, 1),
    until: until ? dateIn(until, base.start.zone) : null,
  }
}

interface Reading {
  timeZone: string
  window: Window
  keep: Keep
}

/** An event with its id, which every event kept has. */
interface Identified {
  uid: string
  component: Component
}

/** An event kept, waiting for its repeats to be worked out: null `job` when it does not repeat. */
interface Planned {
  base: Base
  skipped: Set<IsoDate>
  until: Moment | null
  job: RuleJob | null
}

/** What an event needs for its repeats, or null when it is left out (cancelled, not kept). */
function planOf(
  { uid, component: master }: Identified,
  overrides: Component[],
  read: Reading,
): Planned | null {
  const base = baseOf(master, uid)
  if (!base || isCancelled(master)) return null
  if (!read.keep(occurrence(base, base.start.date, read.timeZone))) return null
  const rule = parseRule(first(master, 'RRULE')?.value)
  const until = momentOf(rule?.until ?? undefined)
  const job = rule && { first: base.start.date, rule, bounds: boundsOf(base, until, read.window) }
  return { base, skipped: skippedDays(master, base.start.zone, overrides), until, job }
}

/** An event's repeats on these days (in its zone), less those skipped, changed or past UNTIL. */
function eventsOf(plan: Planned, starts: IsoDate[], timeZone: string): CalendarEvent[] {
  return starts
    .filter((date) => !plan.skipped.has(date) && beforeUntil(plan.base, plan.until, date))
    .map((date) => occurrence(plan.base, date, timeZone))
}

/** One repeat changed on its own (it has a RECURRENCE-ID): kept as written, unless cancelled. */
function changedRepeat({ uid, component: override }: Identified, read: Reading): CalendarEvent[] {
  const base = baseOf(override, uid)
  if (!base || isCancelled(override)) return []
  const event = occurrence(base, base.start.date, read.timeZone)
  return read.keep(event) ? [event] : []
}

/** The latest MAX_EVENTS: the far past goes first, since the forecast looks ahead. */
function latest(events: Iterable<CalendarEvent>): CalendarEvent[] {
  return [...events]
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.uid.localeCompare(b.uid))
    .slice(-MAX_EVENTS)
}

/**
 * The events in an .ics file that touch the window and that `keep` keeps,
 * soonest first. Past MAX_EVENTS, the oldest are dropped. A repeat of the
 * same event on the same day is kept once. Repeats are worked out within
 * `budget`, shared among the repeating events; one that needs more than its
 * share is left out, and the budget says so, for the caller to tell the owner.
 */
export function parseCalendar(
  text: string,
  timeZone: string,
  window: Window,
  keep: Keep = () => true,
  budget: WorkBudget = workBudget(),
): CalendarEvent[] {
  const masters: Identified[] = []
  const changed: Identified[] = []
  // Events called off as a whole: a repeat of one changed on its own is called off too.
  const cancelled = new Set<string>()
  for (const component of componentsOf(text)) {
    const uid = uidOf(component)
    if (!uid) continue
    if (component.has('RECURRENCE-ID')) changed.push({ uid, component })
    else {
      masters.push({ uid, component })
      if (isCancelled(component)) cancelled.add(uid)
    }
  }
  const read: Reading = { timeZone, window, keep }
  let found = new Map<string, CalendarEvent>()
  const add = (events: CalendarEvent[]) => {
    for (const event of events) {
      if (event.endsOn < window.from || event.startsOn > window.to) continue
      found.set(`${event.uid} ${event.startsOn}`, event)
    }
    // Trimmed as it grows, so a file of many repeating events stays small in memory.
    if (found.size > 2 * MAX_EVENTS) {
      found = new Map(latest(found.values()).map((e) => [`${e.uid} ${e.startsOn}`, e]))
    }
  }
  const changedOf = new Map<string, Component[]>()
  for (const { uid, component } of changed) {
    changedOf.set(uid, [...(changedOf.get(uid) ?? []), component])
  }
  const plans = masters.flatMap(
    (master) => planOf(master, changedOf.get(master.uid) ?? [], read) ?? [],
  )
  // Every rule's repeats at once, so the file's work is shared fairly among them.
  const repeats = expandAll(
    plans.flatMap((plan) => plan.job ?? []),
    budget,
  )
  let next = 0
  for (const plan of plans) {
    // An event that does not repeat starts once, on its first day; a rule left out, never.
    const starts = plan.job ? repeats[next++] : [plan.base.start.date]
    if (starts) add(eventsOf(plan, starts, timeZone))
  }
  for (const repeat of changed) {
    if (!cancelled.has(repeat.uid)) add(changedRepeat(repeat, read))
  }
  return latest(found.values())
}
