// Which trip a trip's piece belongs to. A trip is often written as several
// events: the trip itself ("Rome trip"), getting there ("Flight to Rome") and
// a stay ("Hotel Rome"); a calendar filled from booking emails may hold only
// the flights and the hotel. Travel is what joins pieces across days, so it
// is also what could bridge two trips into one and leave a booking unplanned
// for; these rules let travel join its own trip without carrying it into the
// next, and never let travel alone make a trip of its own beside the real one.
// Pure.

import { addDays, daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'
import type { TripRole } from './occasions.js'
import { sharesWord } from './occasions.js'

/** How well a piece fits a span: not at all, or it fits, or it names the same thing. */
export type Fit = 'none' | 'fits' | 'named'

/**
 * How many days after a trip's stays a flight naming nowhere still counts as
 * the way home ("Rome trip" to the 5th, "Flight home" on the 7th).
 */
const RETURN_DAYS = 2

/** How long a trip that is only a flight out waits for the flight back. */
const RETURN_WAIT_DAYS = 30

/** What a trip being built says about itself so far. */
export interface TripSoFar {
  span: { startsOn: IsoDate; endsOn: IsoDate }
  /**
   * Where the trip goes, from its first piece naming somewhere: a trip piece
   * of its own replaces what its travel said. Never every piece's words
   * pooled, so two pieces naming two places cannot bridge two trips.
   */
  anchor: Set<string>
  /** The last day of the trip's own pieces, not its travel; null while it is only travel. */
  ownEnd: IsoDate | null
  /** The last day of its own pieces or its stays: what the flight home follows. */
  stayEnd: IsoDate | null
  /** The first day of its stays, null with none: tells a night on the way from a stay of its own. */
  stayFrom: IsoDate | null
  /** The day its latest flight leaves, null with none: a flight after its stays leaves it. */
  leftOn: IsoDate | null
  /** True while it is one flight out and nothing else, waiting for the flight back. */
  awaitsReturn: boolean
}

/** A trip's piece being placed. */
export interface TripPiece {
  event: { startsOn: IsoDate; endsOn: IsoDate }
  words: Set<string>
  role: TripRole
  /** True for travel on the day a trip starts or the day before: the way out to it. */
  leadsIntoTrip: boolean
}

/**
 * The last day any piece could still join a trip: the day after it, a few
 * days after its stays for the flight home, or weeks after a lone flight out
 * for the flight back. Past it, the trip is finished.
 */
export function tripReach(trip: TripSoFar): IsoDate {
  let reach = addDays(trip.span.endsOn, 1)
  if (trip.stayEnd !== null) reach = maxDate(reach, addDays(trip.stayEnd, RETURN_DAYS))
  if (trip.awaitsReturn) reach = maxDate(reach, addDays(trip.span.startsOn, RETURN_WAIT_DAYS))
  return reach
}

/** True when a flight leaves after the trip's stays: anything later is somewhere else. */
function hasLeft(trip: TripSoFar): boolean {
  return trip.leftOn !== null && trip.stayEnd !== null && trip.leftOn > trip.stayEnd
}

/**
 * True when a trip that is only travel so far holds nothing but a night on
 * the way to one starting on `start`: getting there alone, or an airport
 * hotel. A one-night stay is written either as one whole day (the night
 * before the trip) or as a timed booking over two days, checking out the
 * day the trip starts; a flight after it (an early flight out) moves the
 * trip's start up to the day after that flight. A longer stay, or one
 * ending before the trip, is a trip of its own ("Hotel Chicago" before
 * "Maui vacation").
 */
function onTheWay(trip: TripSoFar, start: IsoDate): boolean {
  if (trip.stayFrom === null || trip.stayEnd === null) return true
  const stayDays = daysBetween(trip.stayFrom, trip.stayEnd) + 1
  if (stayDays > 2) return false
  if (trip.leftOn !== null && trip.leftOn >= trip.stayEnd) {
    return start <= addDays(trip.span.endsOn, 1)
  }
  return start <= (stayDays === 1 ? addDays(trip.stayEnd, 1) : trip.stayEnd)
}

/**
 * A flight joins a trip when it falls during the trip's days or stays, or the
 * day after them: its own flights, and the flight home wherever it says it
 * goes ("Flight to Denver" after Rome). It also joins:
 *
 * - as the way home, naming nowhere, a few days after the trip's stays;
 * - as the flight back, a trip that is only a flight out, within weeks;
 * - any trip within reach of its days, when `nameFits`.
 *
 * The first two never take the way out to a trip starting that day or the
 * next, which belongs to that trip instead.
 */
function flightFits(trip: TripSoFar, piece: TripPiece, nameFits: boolean): boolean {
  const start = piece.event.startsOn
  const { stayEnd } = trip
  if (stayEnd !== null && start <= addDays(stayEnd, 1)) return true
  if (!piece.leadsIntoTrip) {
    const wayHome = stayEnd !== null && !piece.words.size
    if (wayHome && start <= addDays(stayEnd, RETURN_DAYS)) return true
    if (trip.awaitsReturn && start <= addDays(trip.span.startsOn, RETURN_WAIT_DAYS)) return true
  }
  return start <= addDays(trip.span.endsOn, 1) && nameFits
}

/**
 * A stay joins a trip whose own days it starts within, or a trip that is only
 * a flight there so far ("Flight to NYC", then the hotel). Past the trip's
 * own days it joins only when `nameFits` and no flight has left the trip
 * since, so a stay somewhere else after the trip ("Hotel Vail" after Rome,
 * or a hotel after the flight home) is a trip of its own, and two stays in
 * two places stay two.
 */
function stayFits(trip: TripSoFar, piece: TripPiece, nameFits: boolean): boolean {
  const start = piece.event.startsOn
  if (trip.ownEnd !== null && start <= trip.ownEnd) return true
  if (start > addDays(trip.span.endsOn, 1) || hasLeft(trip)) return false
  const onlyFlights = trip.ownEnd === null && trip.stayEnd === null
  return onlyFlights || nameFits
}

/**
 * A trip's own piece joins:
 *
 * - a span that is only travel so far, whatever either names, when it starts
 *   the day after or during the travel's stays: a flight, a night on the way
 *   or a hotel checked into the day before is no trip by itself ("Flight to
 *   Lisbon", then "Portugal vacation"). A stay ending before it joins only by name;
 * - a trip whose own days hold it wholly (a day trip during a vacation);
 * - a trip it touches when the two name the same place or one names nowhere,
 *   measured from the trip's own days, not its travel, so a flight home on
 *   the day another trip starts does not join the two. Two trips naming
 *   nowhere join only when they overlap: back-to-back getaways are two.
 */
function ownFits(trip: TripSoFar, piece: TripPiece, named: boolean, unnamed: boolean): boolean {
  const { startsOn: start, endsOn } = piece.event
  if (trip.ownEnd === null) {
    if (start > addDays(trip.span.endsOn, 1)) return false
    const duringStay = trip.stayEnd !== null && start <= trip.stayEnd
    return duringStay || onTheWay(trip, start) || named || unnamed
  }
  if (start >= trip.span.startsOn && endsOn <= trip.ownEnd) return true
  if (start > addDays(trip.ownEnd, 1)) return false
  if (!trip.anchor.size && !piece.words.size) return start <= trip.ownEnd
  return named || unnamed
}

/** True when a trip's piece fits a trip being built, by what part of a trip it is. */
function fitsByRole(trip: TripSoFar, piece: TripPiece, named: boolean, unnamed: boolean): boolean {
  if (piece.role === 'own') return ownFits(trip, piece, named, unnamed)
  if (piece.role === 'transport') return flightFits(trip, piece, named || unnamed)
  return stayFits(trip, piece, named || unnamed)
}

/** How a trip's piece fits a trip being built (both trips, the piece within its reach). */
export function tripFit(trip: TripSoFar, piece: TripPiece): Fit {
  const named = sharesWord(trip.anchor, piece.words)
  const unnamed = !trip.anchor.size || !piece.words.size
  if (!fitsByRole(trip, piece, named, unnamed)) return 'none'
  return named ? 'named' : 'fits'
}

/** True when travel comes after the trip's own days and stays: a way home, rather than out. */
export function followsTrip(trip: TripSoFar, piece: TripPiece): boolean {
  return piece.role !== 'own' && trip.stayEnd !== null && trip.stayEnd < piece.event.startsOn
}
