// Calendar dates as YYYY-MM-DD strings, in the owner's time zone.

/** The date `days` days before now, as the calendar shows it in `timeZone`. */
export function isoDaysAgo(days: number, timeZone: string, now = Date.now()): string {
  // en-CA formats dates as YYYY-MM-DD, which is exactly the form the server uses.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(now - days * 86_400_000))
}
