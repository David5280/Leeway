// The time zones a calendar file names (TZID), read to the names Intl uses.
// Files spell zones their own way ("america/denver", "US/Eastern", "Eastern
// Standard Time", an id made up by the calendar), and asking Intl about a
// name is slow, so a file naming thousands of zones, each spelled anew,
// could keep the server busy. Every zone Intl lists is known up front,
// whatever its case; only names not listed (links like US/Eastern, or made
// up) are asked about, a bounded number of times per file. Pure but for
// remembering the names Intl resolved, a fixed set.

/**
 * Every zone known, by its name in lower case: each zone Intl lists, and
 * each name Intl has resolved a file's zone to that it does not list (such
 * as Etc/GMT-9 or EST5EDT). Intl resolves names to a fixed set, so this
 * stays small; MAX_KNOWN is only a backstop.
 */
const known = new Map(
  [...Intl.supportedValuesOf('timeZone'), 'UTC'].map((zone) => [zone.toLowerCase(), zone]),
)
const MAX_KNOWN = 2000

/**
 * The most names not known one file may have Intl look up. Past it, the
 * rest read as floating, which is right to the day for anyone living there.
 */
export const MAX_ZONE_LOOKUPS = 200

/** A zone already known, in any case, by its own name; null for any other name. */
export function knownZone(name: string): string | null {
  return known.get(name.trim().toLowerCase()) ?? null
}

/** The zone Intl resolves a name to, remembered as known; null when Intl cannot place it. */
function lookedUp(name: string): string | null {
  try {
    const { timeZone } = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions()
    const zone = knownZone(timeZone) ?? timeZone
    if (known.size < MAX_KNOWN) known.set(zone.toLowerCase(), zone)
    return zone
  } catch {
    return null
  }
}

/**
 * Reads one file's zone names to Intl's, null for one it cannot place. Made
 * once per file: it remembers the names it looked up for that file alone,
 * so each file looks up at most MAX_ZONE_LOOKUPS names.
 */
export function zoneReader(): (name: string) => string | null {
  const lookups = new Map<string, string | null>()
  return (name) => {
    const zone = knownZone(name)
    if (zone) return zone
    const key = name.trim().toLowerCase()
    const found = lookups.get(key)
    if (found !== undefined) return found
    if (lookups.size >= MAX_ZONE_LOOKUPS) return null
    const resolved = lookedUp(key)
    lookups.set(key, resolved)
    return resolved
  }
}
