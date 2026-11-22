// The lines of an iCalendar (.ics) file as events' properties: folded lines
// joined, parameters split off, text unescaped and cleaned. Pure.

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
    else if (nested === 0) addProperty(current, propertyOf(line))
  }
  return components
}

function addProperty(component: Component, property: Property | null): void {
  if (!property) return
  component.set(property.name, [...(component.get(property.name) ?? []), property])
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

export function isCancelled(component: Component): boolean {
  return first(component, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
}
