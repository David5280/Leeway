// Calendar files for the calendar tests: events written as their lines, a
// read of one that gives just its events, and timing how long a read takes.

import { parseCalendar, type CalendarEvent, type Window } from '../../src/domain/calendar/ics.js'

/** A calendar file holding these events, each given as its lines. */
export function ics(...events: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')
}

/** The events parseCalendar reads from a file, without whether it capped them. */
export function eventsIn(
  text: string,
  timeZone: string,
  window: Window,
  options?: Parameters<typeof parseCalendar>[3],
): CalendarEvent[] {
  return parseCalendar(text, timeZone, window, options).events
}

/**
 * How long a read built to be slow may take. Each runs in a fraction of this
 * on a laptop; the bound is loose so a slow CI machine never fails it, yet
 * tight enough that the seconds-long reads these guard against always would.
 */
export const QUICK_MS = 1000

/** How long `work` takes, in milliseconds. */
export function timed(work: () => void): number {
  const started = performance.now()
  work()
  return performance.now() - started
}

/** A calendar day `i` days after 2016-01-01, as an .ics date. */
export function icsDay(i: number): string {
  return new Date(Date.UTC(2016, 0, 1) + i * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '')
}
