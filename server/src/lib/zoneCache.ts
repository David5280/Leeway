// Maps keyed by time zone, such as one Intl formatter per zone, bounded so
// no run of zone names can grow them without end.

/**
 * Zones remembered at once in a map keyed by zone. Callers pass zones Intl
 * knows (a calendar's own names are read to those first), a few hundred in
 * all, so every one fits and this is only a backstop on memory.
 */
export const MAX_ZONES = 1000

/**
 * One entry for `timeZone` in a map keyed by zone, made on first use. Past
 * MAX_ZONES zones the one remembered longest is let go, never the whole map,
 * so a file cycling through more zones never makes every zone start again.
 */
export function perZone<T>(map: Map<string, T>, timeZone: string, make: () => T): T {
  let entry = map.get(timeZone)
  if (entry === undefined) {
    // A Map keeps the order entries were added in, so its first key is the oldest.
    const oldest = map.keys().next()
    if (map.size >= MAX_ZONES && !oldest.done) map.delete(oldest.value)
    entry = make()
    map.set(timeZone, entry)
  }
  return entry
}
