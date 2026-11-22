// The time zones a calendar file names (TZID), read to the names Intl uses.
// Files spell zones their own way ("america/denver", "US/Eastern", "Eastern
// Standard Time", an id made up by the calendar), and asking Intl about a
// name is slow, so a file naming thousands of zones, each spelled anew,
// could keep the server busy. Every zone Intl lists is known up front,
// whatever its case; only names not listed (links like US/Eastern, or made
// up) are asked about, a bounded number of times per file. Pure.

/** Each zone Intl lists, by its name in lower case. Its links all read to one of these. */
const LISTED = new Map(
  [...Intl.supportedValuesOf('timeZone'), 'UTC'].map((zone) => [zone.toLowerCase(), zone]),
)

/**
 * The most names not listed one file may have Intl look up. Past it, the
 * rest read as floating, which is right to the day for anyone living there.
 */
export const MAX_ZONE_LOOKUPS = 200

/** A zone Intl lists, in any case, by its own name; null for any other name. */
export function listedZone(name: string): string | null {
  return LISTED.get(name.trim().toLowerCase()) ?? null
}

/** The zone Intl reads a name not listed as (a link to a listed zone), or null when it is unknown. */
function lookedUp(name: string): string | null {
  try {
    const { timeZone } = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions()
    return listedZone(timeZone)
  } catch {
    return null
  }
}

/**
 * Reads one file's zone names to Intl's, null for one it cannot place. Made
 * once per file: it remembers the names it looked up for that file alone,
 * so memory and lookups both end with the read.
 */
export function zoneReader(): (name: string) => string | null {
  const lookups = new Map<string, string | null>()
  return (name) => {
    const listed = listedZone(name)
    if (listed) return listed
    const key = name.trim().toLowerCase()
    const known = lookups.get(key)
    if (known !== undefined) return known
    if (lookups.size >= MAX_ZONE_LOOKUPS) return null
    const zone = lookedUp(key)
    lookups.set(key, zone)
    return zone
  }
}
