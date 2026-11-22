// Maps keyed by time zone, such as one Intl formatter per zone, bounded so
// no run of zone names can grow them without end.

/**
 * Zones remembered at once before a map keyed by zone is emptied. Callers
 * pass zones Intl lists (a calendar's own names are read to those first), so
 * this is only a backstop on memory: few people's calendars name a dozen.
 */
export const MAX_ZONES = 100

/** One entry for `timeZone` in a map keyed by zone, made on first use and never past MAX_ZONES zones. */
export function perZone<T>(map: Map<string, T>, timeZone: string, make: () => T): T {
  let entry = map.get(timeZone)
  if (entry === undefined) {
    if (map.size >= MAX_ZONES) map.clear()
    entry = make()
    map.set(timeZone, entry)
  }
  return entry
}
