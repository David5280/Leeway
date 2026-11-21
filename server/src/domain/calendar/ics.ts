// Reads an iCalendar (.ics) file into events: what each is called, where, and
// which days it covers in the owner's time zone. Only what a money forecast
// needs is read; a yearly event (a birthday, a holiday) is repeated across the
// window asked for, and other repeating events keep their first day. Pure.

import {
  addDays,
  dateParts,
  daysBetween,
  makeDate,
  todayIn,
  type IsoDate,
} from '../../lib/dates.js'

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

/** The most events kept from one file, so a huge calendar stays small to store. */
export const MAX_EVENTS = 5000

/** The longest title or location kept, in characters. */
const MAX_TEXT = 200

interface Property {
  name: string
  params: Record<string, string>
  value: string
}

/** Lines with their folded continuations joined back on (RFC 5545, 3.1). */
function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

/** One content line: NAME;PARAM=VALUE:value. A colon inside a quoted parameter is not the split. */
function propertyOf(line: string): Property | null {
  let quoted = false
  let split = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      split = i
      break
    }
  }
  if (split < 1) return null
  const [name, ...parts] = line.slice(0, split).split(';')
  const params: Record<string, string> = {}
  for (const part of parts) {
    const [key, value = ''] = part.split('=')
    params[key!.toUpperCase()] = value.replace(/^"|"$/g, '')
  }
  return { name: name!.toUpperCase(), params, value: line.slice(split + 1) }
}

/** Text with its escapes undone and line breaks made spaces, trimmed to MAX_TEXT. */
function textOf(value: string | undefined): string | null {
  if (value === undefined) return null
  const text = value
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, MAX_TEXT) : null
}

interface When {
  date: IsoDate
  /** True for a whole day (VALUE=DATE); false for a moment in it. */
  allDay: boolean
  /** True when a moment is exactly midnight, which as an end means the day before. */
  midnight: boolean
}

/**
 * A DTSTART or DTEND as a day in the owner's time zone. A UTC moment ("Z") is
 * moved into that zone; a local or floating one is already on its day.
 */
function whenOf(property: Property | undefined, timeZone: string): When | null {
  const match = property?.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second, utc] = match
  const date = makeDate(Number(year), Number(month), Number(day))
  if (hour === undefined) return { date, allDay: true, midnight: true }
  const midnight = hour === '00' && minute === '00' && second === '00'
  if (!utc) return { date, allDay: false, midnight }
  const instant = new Date(`${date}T${hour}:${minute}:${second}Z`)
  return { date: todayIn(timeZone, instant), allDay: false, midnight: false }
}

/** Whole days in a DURATION like P3D or P1W, when it has any. */
function durationDays(value: string | undefined): number {
  const match = value?.match(/^P(?:(\d+)W)?(?:(\d+)D)?/)
  if (!match) return 0
  return Number(match[1] ?? 0) * 7 + Number(match[2] ?? 0)
}

/** The last day an event covers. An all-day end, or a timed end at midnight, is exclusive. */
function lastDay(start: When, end: When | null, duration: number): IsoDate {
  let last = start.date
  if (end) last = end.midnight && end.date > start.date ? addDays(end.date, -1) : end.date
  else if (duration > 0) last = addDays(start.date, start.allDay ? duration - 1 : duration)
  return last < start.date ? start.date : last
}

/** The same day of the year in another year; February 29 falls on the 28th. */
function inYear(date: IsoDate, year: number): IsoDate {
  const { month, day } = dateParts(date)
  return month === 2 && day === 29 && makeDate(year, 3, 1) === makeDate(year, 2, 29)
    ? makeDate(year, 2, 28)
    : makeDate(year, month, day)
}

/** The days a repeating rule starts the event on, within the window: yearly ones only. */
function startsOf(first: IsoDate, rule: string | undefined, window: Window): IsoDate[] {
  if (!rule || !/(^|;)FREQ=YEARLY(;|$)/.test(rule)) return [first]
  const until = rule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/)
  const last = until ? makeDate(Number(until[1]), Number(until[2]), Number(until[3])) : window.to
  const starts: IsoDate[] = []
  for (let year = dateParts(window.from).year - 1; year <= dateParts(window.to).year; year++) {
    const start = inYear(first, year)
    if (start >= first && start <= last) starts.push(start)
  }
  return starts
}

/** One VEVENT's properties as events: once, or once a year when it repeats yearly. */
function eventsOf(props: Map<string, Property>, timeZone: string, window: Window): CalendarEvent[] {
  if (props.get('STATUS')?.value.toUpperCase() === 'CANCELLED') return []
  const start = whenOf(props.get('DTSTART'), timeZone)
  const uid = props.get('UID')?.value.trim()
  if (!start || !uid) return []
  const end = whenOf(props.get('DTEND'), timeZone)
  const duration = durationDays(props.get('DURATION')?.value)
  const span = daysBetween(start.date, lastDay(start, end, duration))
  const title = textOf(props.get('SUMMARY')?.value) ?? 'Untitled event'
  const location = textOf(props.get('LOCATION')?.value)
  return startsOf(start.date, props.get('RRULE')?.value, window)
    .map((startsOn) => ({
      uid: uid.slice(0, MAX_TEXT),
      startsOn,
      endsOn: addDays(startsOn, span),
      title,
      location,
      allDay: start.allDay,
    }))
    .filter((event) => event.endsOn >= window.from && event.startsOn <= window.to)
}

/**
 * The events in an .ics file that touch the window, soonest first, at most
 * MAX_EVENTS. A repeat of the same event on the same day is kept once.
 */
export function parseCalendar(text: string, timeZone: string, window: Window): CalendarEvent[] {
  const found = new Map<string, CalendarEvent>()
  let props: Map<string, Property> | null = null
  // How deep inside the event a line is: an alarm's own lines are not the event's.
  let nested = 0
  for (const line of unfold(text)) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      props = new Map()
      nested = 0
    } else if (!props) continue
    else if (upper === 'END:VEVENT') {
      for (const event of eventsOf(props, timeZone, window)) {
        found.set(`${event.uid} ${event.startsOn}`, event)
      }
      props = null
    } else if (upper.startsWith('BEGIN:')) nested++
    else if (upper.startsWith('END:')) nested--
    else if (nested === 0) {
      const property = propertyOf(line)
      if (property && !props.has(property.name)) props.set(property.name, property)
    }
  }
  return [...found.values()]
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.uid.localeCompare(b.uid))
    .slice(0, MAX_EVENTS)
}
