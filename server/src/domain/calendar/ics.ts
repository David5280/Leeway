// Reads an iCalendar (.ics) file into events: what each is called, where, and
// which days it covers in the owner's time zone. Only what a money forecast
// needs is read. Each event is first looked at by its words and the most days
// it could cover, so the many a forecast has no use for (meetings) are left
// out before any time zone math. A repeating event is expanded across the
// window asked for (recurrence.ts), less the days it skips (EXDATE) and the
// repeats changed on their own (RECURRENCE-ID), which replace the repeat or,
// when cancelled, remove it. An event the calendar's owner declined is left
// out like a cancelled one, when the file says whose calendar it is
// (components.ts). Working out repeats draws on one budget per
// file, shared among its rules (repeatShares.ts), so no file can keep the
// server busy. Pure.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'
import {
  calendarAddressOf,
  componentsOf,
  first,
  isCancelled,
  isDeclinedBy,
  uidOf,
  type Component,
} from './components.js'
import { exceptionsNear, placingUnits, skippedDays, type Exceptions } from './exceptions.js'
import { dateIn, momentOf, onDate, timelineMs, type Moment } from './moments.js'
import { bySoonest, MAX_EVENTS, nearest } from './nearest.js'
import {
  baseOf,
  measure,
  momentOfProperty,
  occurrence,
  previewOf,
  unitsPerRepeat,
  type Measured,
} from './occurrences.js'
import { workBudget, type WorkBudget } from './recurrence.js'
import { expandAll, type RuleJob } from './repeatShares.js'
import { parseRule, type Bounds } from './rule.js'

export { MAX_EVENTS } from './nearest.js'

export interface CalendarEvent {
  /** The calendar's own id for the event; a repeat shares it, told apart by its start. */
  uid: string
  /**
   * For one repeat of a repeating event, the day it was set for in the series
   * (on the series' own clock), which stays the same when that repeat alone
   * is moved: its RECURRENCE-ID. Null for an event that happens once.
   */
  repeatOn: IsoDate | null
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

/** What is known of an event before its days are worked out: enough to leave most out cheaply. */
export interface Preview {
  title: string
  location: string | null
  allDay: boolean
  /** The most days it could cover on the owner's calendar; it may cover fewer. */
  mostDays: number
}

/** Which events to keep, asked of each event once, before its repeats are worked out. */
export interface Keep {
  /** A first look, before any time zone math. Never false for an event `keeps` would keep. */
  mayKeep: (preview: Preview) => boolean
  /** The last word, on the days the event's first repeat covers. */
  keeps: (event: CalendarEvent) => boolean
}

/**
 * Which event this is, for good: the calendar's id, and for a repeat the day
 * it was set for. A repeat moved on its own keeps it, and its neighbours in
 * the series (which share the calendar's id) never have it.
 */
export function eventIdOf(event: { uid: string; repeatOn?: IsoDate | null }): string {
  return event.repeatOn ? `${event.uid} ${event.repeatOn}` : event.uid
}

export const KEEP_ALL: Keep = { mayKeep: () => true, keeps: () => true }

export interface ReadOptions {
  keep?: Keep
  /** The work allowed for repeats, which says afterwards whether it ran out. */
  budget?: WorkBudget
  /** The day the events kept past MAX_EVENTS are nearest to: the window's end when not given. */
  today?: IsoDate
}

/** A calendar read: its events, and whether MAX_EVENTS left some out. */
export interface ParsedCalendar {
  events: CalendarEvent[]
  capped: boolean
}

/**
 * True when a repeat starting on `date` is not after UNTIL. An UNTIL with a
 * time is an instant, so a repeat later that day is past it; a whole-day
 * event, or a whole-day UNTIL, is compared by day, as expandRule already did.
 */
function beforeUntil(event: Measured, until: Moment | null, date: IsoDate): boolean {
  if (!until || until.seconds === null || event.start.seconds === null) return true
  return timelineMs(onDate(event.start, date)) <= timelineMs(until)
}

/** The days a rule is asked for: near the window, and none after UNTIL. */
function boundsOf(event: Measured, until: Moment | null, window: Window): Bounds {
  // A day's slack either side, as the event's zone and the owner's may differ by one.
  const spanDays = Math.ceil(event.lengthMs / DAY_MS) + 1
  return {
    from: addDays(window.from, -spanDays),
    to: addDays(window.to, 1),
    until: until ? dateIn(until, event.start.zone) : null,
  }
}

interface Reading {
  timeZone: string
  /** Whose calendar it is, when the file says: events they declined are left out. */
  owner: string | null
  window: Window
  keep: Keep
  budget: WorkBudget
}

/** An event with its id, which every event kept has. */
interface Identified {
  uid: string
  component: Component
}

/** An event kept, waiting for its repeats to be worked out: null `job` when it has no work to share. */
interface Planned {
  event: Measured
  exceptions: Exceptions
  until: Moment | null
  job: RuleJob | null
}

/** An event read and kept (its first repeat too), or null when it is left out: cancelled, declined or not kept. */
function keptEvent({ uid, component }: Identified, read: Reading): Measured | null {
  const base = baseOf(component, uid)
  if (!base || isCancelled(component) || isDeclinedBy(component, read.owner)) return null
  if (!read.keep.mayKeep(previewOf(base))) return null
  const event = measure(base)
  return read.keep.keeps(occurrence(event, base.start.date, read.timeZone, null)) ? event : null
}

/**
 * What an event needs for its repeats, or null when it is left out (cancelled
 * or not kept). Its exceptions are paid for with its rule (expandAll), cheapest
 * first among the file's events; an event that neither repeats nor has any
 * to pay for needs no job.
 */
function planOf(master: Identified, overrides: Component[], read: Reading): Planned | null {
  const event = keptEvent(master, read)
  if (!event) return null
  const rule = parseRule(first(master.component, 'RRULE')?.value)
  const until = momentOf(rule?.until ?? undefined)
  const bounds = boundsOf(event, until, read.window)
  const exceptions = exceptionsNear(master.component, event.start.zone, overrides, bounds)
  const upfrontUnits = placingUnits(exceptions)
  if (!rule && upfrontUnits === 0) return { event, exceptions, until, job: null }
  const job = {
    first: event.start.date,
    rule,
    bounds,
    unitsPerRepeat: unitsPerRepeat(event),
    upfrontUnits,
  }
  return { event, exceptions, until, job }
}

/**
 * An event's repeats on these days (in its zone), less those skipped, changed
 * or past UNTIL. Each repeat of a rule is known by the day it starts on (repeatOn).
 */
function eventsOf(plan: Planned, starts: IsoDate[], timeZone: string): CalendarEvent[] {
  const skipped = skippedDays(plan.exceptions, plan.event.start.zone)
  const inSeries = Boolean(plan.job?.rule)
  return starts
    .filter((date) => !skipped.has(date) && beforeUntil(plan.event, plan.until, date))
    .map((date) => occurrence(plan.event, date, timeZone, inSeries ? date : null))
}

/**
 * One repeat changed on its own (it has a RECURRENCE-ID): kept as written,
 * unless cancelled. It is known by the day it was set for, read on its
 * series' clock (`seriesZone`) as the series' own repeats are, or on its
 * own when the series was left out.
 */
function changedRepeat(
  repeat: Identified,
  read: Reading,
  seriesZone: string | null | undefined,
): CalendarEvent[] {
  const event = keptEvent(repeat, read)
  if (!event) return []
  const original = momentOfProperty(first(repeat.component, 'RECURRENCE-ID'))
  const repeatOn = original ? dateIn(original, seriesZone ?? event.start.zone) : null
  return [occurrence(event, event.start.date, read.timeZone, repeatOn)]
}

/** The file's events, split into the events themselves and their repeats changed on their own. */
function sortedOut(text: string) {
  const masters: Identified[] = []
  const changedOf = new Map<string, Component[]>()
  // Events called off as a whole: a repeat of one changed on its own is called off too.
  const cancelled = new Set<string>()
  for (const component of componentsOf(text)) {
    const uid = uidOf(component)
    if (!uid) continue
    if (component.has('RECURRENCE-ID')) {
      const changed = changedOf.get(uid)
      if (changed) changed.push(component)
      else changedOf.set(uid, [component])
    } else {
      masters.push({ uid, component })
      if (isCancelled(component)) cancelled.add(uid)
    }
  }
  return { masters, changedOf, cancelled }
}

/**
 * The events in an .ics file that touch the window and that `keep` keeps,
 * soonest first. Past MAX_EVENTS, those furthest from `today` are dropped
 * and `capped` says so. A repeat of the same event on the same day is kept
 * once. Repeats are worked out within `budget`, shared among the repeating
 * events; one that needs more than the budget can give is left out, and the
 * budget says so, for the caller to tell the owner.
 */
export function parseCalendar(
  text: string,
  timeZone: string,
  window: Window,
  { keep = KEEP_ALL, budget = workBudget(), today = window.to }: ReadOptions = {},
): ParsedCalendar {
  const { masters, changedOf, cancelled } = sortedOut(text)
  const read: Reading = { timeZone, owner: calendarAddressOf(text), window, keep, budget }
  let found = new Map<string, CalendarEvent>()
  let capped = false
  const add = (events: CalendarEvent[]) => {
    for (const event of events) {
      if (event.endsOn < window.from || event.startsOn > window.to) continue
      found.set(`${event.uid} ${event.startsOn}`, event)
    }
    // Trimmed as it grows, so a file of many repeating events stays small in memory.
    if (found.size > 2 * MAX_EVENTS) {
      found = new Map(nearest(found.values(), today).map((e) => [`${e.uid} ${e.startsOn}`, e]))
      capped = true
    }
  }
  const plans = masters.flatMap(
    (master) => planOf(master, changedOf.get(master.uid) ?? [], read) ?? [],
  )
  // Every rule's repeats at once, so the file's work is shared among them.
  const repeats = expandAll(
    plans.flatMap((plan) => plan.job ?? []),
    budget,
  )
  let next = 0
  for (const plan of plans) {
    // An event with no job starts once, on its first day; one left out, never.
    const starts = plan.job ? repeats[next++] : [plan.event.start.date]
    if (starts) add(eventsOf(plan, starts, timeZone))
  }
  const seriesZones = new Map(plans.map((plan) => [plan.event.uid, plan.event.start.zone]))
  for (const [uid, changed] of changedOf) {
    if (cancelled.has(uid)) continue
    const zone = seriesZones.get(uid)
    for (const repeat of changed) add(changedRepeat({ uid, component: repeat }, read, zone))
  }
  if (found.size <= MAX_EVENTS) return { events: [...found.values()].sort(bySoonest), capped }
  return { events: nearest(found.values(), today), capped: true }
}
