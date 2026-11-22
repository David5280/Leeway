// Which trip a trip's piece belongs to. A trip is often written as several
// events: the trip itself ("Rome trip"), getting there ("Flight to Rome") and
// a stay ("Hotel Rome"); a calendar filled from booking emails may hold only
// the flights and the hotel. Travel is what joins pieces across days, so it
// is also what could bridge two trips into one and leave a booking unplanned
// for; these rules let travel join its own trip without carrying it into the
// next, and never let travel alone make a trip of its own beside the real one.
// Pure.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import type { TripRole } from './occasions.js'
import { sharesWord } from './occasions.js'

/** How well a piece fits a span: not at all, or it fits, or it names the same thing. */
export type Fit = 'none' | 'fits' | 'named'

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
}

/** A trip's piece being placed. */
export interface TripPiece {
  event: { startsOn: IsoDate; endsOn: IsoDate }
  words: Set<string>
  role: TripRole
}

/**
 * True when a trip that is only travel so far holds nothing but a night on
 * the way to one starting on `start`: getting there alone, or an airport
 * hotel. A one-night stay is written either as one whole day (the night
 * before the trip) or as a timed booking over two days, checking out the
 * day the trip starts. A longer stay, or one ending before the trip, is a
 * trip of its own ("Hotel Chicago" before "Maui vacation").
 */
function onTheWay(trip: TripSoFar, start: IsoDate): boolean {
  if (trip.stayFrom === null || trip.stayEnd === null) return true
  const stayDays = daysBetween(trip.stayFrom, trip.stayEnd) + 1
  if (stayDays === 1) return start <= addDays(trip.stayEnd, 1)
  return stayDays === 2 && start <= trip.stayEnd
}

/**
 * Travel joins a trip when it falls during the trip's days or the day after
 * them: its own flights, and the flight home wherever it says it goes
 * ("Flight to Denver" after Rome). A flight follows the trip's stays too, so
 * the flight home after a hotel joins it; a stay follows only the trip's own
 * days, so two stays in two places stay two. Other travel within reach joins
 * only when `nameFits`: it names the same place, or one names nowhere.
 */
function travelFits(trip: TripSoFar, piece: TripPiece, nameFits: boolean): boolean {
  const start = piece.event.startsOn
  const follows = piece.role === 'transport' ? trip.stayEnd : trip.ownEnd
  if (follows !== null && start <= addDays(follows, 1)) return true
  return start <= addDays(trip.span.endsOn, 1) && nameFits
}

/**
 * A trip's own piece joins:
 *
 * - a span that is only travel so far, whatever either names: a flight or a
 *   night on the way is no trip by itself ("Flight to Lisbon", then "Portugal
 *   vacation"). A stay of its own (onTheWay) joins only by name;
 * - a trip whose own days hold it wholly (a day trip during a vacation);
 * - a trip it touches when the two name the same place or one names nowhere,
 *   measured from the trip's own days, not its travel, so a flight home on
 *   the day another trip starts does not join the two. Two trips naming
 *   nowhere join only when they overlap: back-to-back getaways are two.
 */
function ownFits(trip: TripSoFar, piece: TripPiece, named: boolean, unnamed: boolean): boolean {
  const { startsOn: start, endsOn } = piece.event
  if (trip.ownEnd === null) {
    const inReach = start <= addDays(trip.span.endsOn, 1)
    return inReach && (onTheWay(trip, start) || named || unnamed)
  }
  if (start >= trip.span.startsOn && endsOn <= trip.ownEnd) return true
  if (start > addDays(trip.ownEnd, 1)) return false
  if (!trip.anchor.size && !piece.words.size) return start <= trip.ownEnd
  return named || unnamed
}

/** How a trip's piece fits a trip being built (both trips, the piece within reach of the span). */
export function tripFit(trip: TripSoFar, piece: TripPiece): Fit {
  const named = sharesWord(trip.anchor, piece.words)
  const unnamed = !trip.anchor.size || !piece.words.size
  const fits =
    piece.role === 'own'
      ? ownFits(trip, piece, named, unnamed)
      : travelFits(trip, piece, named || unnamed)
  if (!fits) return 'none'
  return named ? 'named' : 'fits'
}

/** True when travel comes after the trip's own days and stays: a way home, rather than out. */
export function followsTrip(trip: TripSoFar, piece: TripPiece): boolean {
  return piece.role !== 'own' && trip.stayEnd !== null && trip.stayEnd < piece.event.startsOn
}
