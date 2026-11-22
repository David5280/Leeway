// Which trip a trip's piece belongs to. A trip is often written as several
// events: the trip itself ("Rome trip") and its travel ("Flight to Rome",
// "Hotel Rome"). Travel is what joins pieces across days, so it is also what
// could bridge two trips into one and leave a booking unplanned for; these
// rules let travel join its own trip without carrying it into the next. Pure.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { sharesWord } from './occasions.js'

/** How well a piece fits a span: not at all, or it fits, or it names the same thing. */
export type Fit = 'none' | 'fits' | 'named'

/** What a trip being built says about itself so far. */
export interface TripSoFar {
  span: { endsOn: IsoDate }
  /**
   * Where the trip goes, from its first piece naming somewhere: a trip piece
   * of its own replaces what its travel said. Never every piece's words
   * pooled, so two pieces naming two places cannot bridge two trips.
   */
  anchor: Set<string>
  anchorIsTravel: boolean
  /** The last day of the trip's own pieces, not its travel; null while it is only travel. */
  ownEnd: IsoDate | null
}

/** A trip's piece being placed. */
export interface TripPiece {
  event: { startsOn: IsoDate }
  words: Set<string>
  travel: boolean
}

/**
 * How a trip's piece fits a trip being built (both the same kind, the piece
 * within reach of the span):
 *
 * - Travel during the trip's own days, or the day after, is that trip's: its
 *   own flights, and the flight home wherever it says it goes ("Flight to
 *   Denver" after Rome).
 * - Other travel joins only when it names the same place, or one of the two
 *   names nowhere ("Flight home", or travel beside a trip still unnamed).
 * - A trip's own piece is measured from the trip's own days, not its travel,
 *   so a flight home on the day another trip starts does not join the two.
 *   It joins when the two name the same place, or one names nowhere: two
 *   trips each named for itself stay two, even when they overlap, and a
 *   flight to one place the day before a trip to another stays its own.
 */
export function tripFit(trip: TripSoFar, piece: TripPiece): Fit {
  const start = piece.event.startsOn
  const named = sharesWord(trip.anchor, piece.words)
  const unnamed = !trip.anchor.size || !piece.words.size
  const fit: Fit = named ? 'named' : 'fits'
  if (piece.travel && trip.ownEnd !== null && start <= addDays(trip.ownEnd, 1)) return fit
  const end = piece.travel ? trip.span.endsOn : (trip.ownEnd ?? trip.span.endsOn)
  if (start > addDays(end, 1)) return 'none'
  return named || unnamed ? fit : 'none'
}
