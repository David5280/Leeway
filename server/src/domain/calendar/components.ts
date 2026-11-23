// The lines of an iCalendar (.ics) file as events' properties: folded lines
// joined, parameters split off, text unescaped and cleaned, and each zone
// named (TZID) read to the name Intl uses, or dropped when unknown. Pure.

import { zoneReader } from './zoneNames.js'

/** The longest title, location or id kept, in characters. */
const MAX_TEXT = 200

/**
 * Control characters other than tab and line breaks: nothing a person
 * reads, and Postgres refuses a NUL in text outright.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

export interface Property {
  name: string
  /** Its parameters by name in upper case; TZID, when kept, is a zone Intl lists. */
  params: Record<string, string>
  value: string
}

/** One VEVENT: each property name with every line that gave it (EXDATE may come many times). */
export type Component = Map<string, Property[]>

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

/** The file's events, each as its own properties; an alarm's lines inside one are not its own. */
export function componentsOf(text: string): Component[] {
  const components: Component[] = []
  const zoneOf = zoneReader()
  let current: Component | null = null
  // How deep inside the event a line is.
  let nested = 0
  for (const line of unfold(text)) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      current = new Map()
      nested = 0
    } else if (!current) continue
    else if (upper === 'END:VEVENT') {
      components.push(current)
      current = null
    } else if (upper.startsWith('BEGIN:')) nested++
    else if (upper.startsWith('END:')) nested--
    else if (nested === 0) addProperty(current, withZone(propertyOf(line), zoneOf))
  }
  return components
}

/**
 * A property with its TZID read to the zone Intl uses, or without one when
 * it names no zone Intl knows: it then reads as floating.
 */
function withZone(
  property: Property | null,
  zoneOf: (name: string) => string | null,
): Property | null {
  if (property?.params.TZID === undefined) return property
  const zone = zoneOf(property.params.TZID)
  if (zone) property.params.TZID = zone
  else delete property.params.TZID
  return property
}

function addProperty(component: Component, property: Property | null): void {
  if (!property) return
  // Pushed in place: an event may list a property thousands of times (EXDATE).
  const lines = component.get(property.name)
  if (lines) lines.push(property)
  else component.set(property.name, [property])
}

/** The first line giving a property. */
export function first(component: Component, name: string): Property | undefined {
  return component.get(name)?.[0]
}

/** Text with escapes undone, control characters dropped and line breaks made spaces, trimmed. */
export function textOf(value: string | undefined): string | null {
  if (value === undefined) return null
  const text = value
    .replace(CONTROL, '')
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, MAX_TEXT) : null
}

export function uidOf(component: Component): string | null {
  const uid = first(component, 'UID')?.value.replace(CONTROL, '').trim()
  return uid ? uid.slice(0, MAX_TEXT) : null
}

/** An email address, as a calendar's name may be one. */
const ADDRESS = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/

/** An address as written, in lower case and without "mailto:", so either spelling compares equal. */
function bareAddress(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .trim()
}

/**
 * Whose calendar the file is, as an email address, when its name is one, as
 * Google names a person's main calendar; null for any other name. Only the
 * lines before the first event are read.
 */
export function calendarAddressOf(text: string): string | null {
  const firstEvent = text.search(/BEGIN:VEVENT/i)
  const head = firstEvent < 0 ? text : text.slice(0, firstEvent)
  const name = unfold(head)
    .map(propertyOf)
    .find((property) => property?.name === 'X-WR-CALNAME')
  const address = name ? bareAddress(name.value) : ''
  return ADDRESS.test(address) ? address : null
}

/** True when the calendar's own `address` is invited to the event and said no. */
export function isDeclinedBy(component: Component, address: string | null): boolean {
  if (!address) return false
  return (component.get('ATTENDEE') ?? []).some(
    (attendee) =>
      attendee.params.PARTSTAT?.toUpperCase() === 'DECLINED' &&
      bareAddress(attendee.value) === address,
  )
}

export function isCancelled(component: Component): boolean {
  return first(component, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
}
