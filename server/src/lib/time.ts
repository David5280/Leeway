// Lengths of time in milliseconds, so a duration reads as what it is
// (`5 * MINUTE_MS`) instead of as a bare number.

export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
/** A calendar day in UTC. A day in a time zone with daylight saving can be an hour off. */
export const DAY_MS = 24 * HOUR_MS
