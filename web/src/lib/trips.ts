// Words and addresses for trips, shared by the forecast, the trip page and
// the transaction sheet.

/** The trip's own page. */
export function tripPath({ startsOn, endsOn }: { startsOn: string; endsOn: string }): string {
  return `/trips/${startsOn}/${endsOn}`
}

/** A trip's name, or "Travel" for a run of travel spending no calendar named. */
export function tripName(trip: { name: string | null }): string {
  return trip.name ?? 'Travel'
}

/** What each part of a trip is called. */
export const TRIP_PART_NAMES = {
  travel: 'Getting there',
  stay: 'Place to stay',
  food: 'Food',
  activities: 'Things to do',
} as const
