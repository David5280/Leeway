// Calendar files for the calendar tests: events written as their lines, and
// a read of one that gives just its events.

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
