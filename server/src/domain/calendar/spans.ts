// One thing in life, written as several calendar events: "Rome trip", "Flight
// to Rome" and "Hotel Rome" are one trip, and "Jo's birthday" with "Jo's bday
// dinner" is one birthday. Those pieces are merged into one span, so each
// occasion is costed and listed once. Two occasions that only share a kind
// and a day ("Alice's birthday" and "Bob's birthday") stay two, since merging
// them would set aside for one, but a piece naming nothing ("Birthday
// dinner") always joins one of them rather than make a third. Pure.

import { addDays, maxDate, minDate, type IsoDate } from '../../lib/dates.js'
import { daysOf, type EventKind } from './kinds.js'
import {
  holidayNames,
  occasionWords,
  sameOccasion,
  sharesWord,
  tripRoleOf,
  type TripRole,
} from './occasions.js'
import { followsTrip, tripFit, type Fit, type TripSoFar } from './tripPieces.js'

/** An event already sorted into a kind. */
export interface KindedEvent {
  /** The calendar's id for the event; with its first day, it tells one event from any other. */
  uid: string
  title: string
  startsOn: IsoDate
  endsOn: IsoDate
  kind: EventKind
}

/** One occasion, made of one or more events. */
export interface EventSpan extends KindedEvent {
  /** Stable for as long as the calendar is: its first event's id and first day. */
  id: string
}

/**
 * Kinds whose pieces the next day still belong to the same occasion: a
 * flight the day before a trip, a "Wedding rehearsal dinner" the night before
 * the wedding, Christmas Eve and Christmas. Birthdays and shows on
 * consecutive days are two.
 */
const JOINS_NEXT_DAY: Record<EventKind, boolean> = {
  trip: true,
  wedding: true,
  holiday: true,
  birthday: false,
  show: false,
}

/** One event, with what its title says about it. */
interface Piece {
  event: KindedEvent
  /** Whose, which or where: a holiday's own name, for a holiday. */
  words: Set<string>
  /** What part of a trip it is; 'own' for every other kind. */
  role: TripRole
  /** A trip's travel (a flight, a hotel) rather than the trip itself. */
  travel: boolean
}

/** A span being built, with what its pieces say about it so far. */
interface Building extends TripSoFar {
  span: EventSpan
  /** How many days the piece the span is named for covers, so the longest names it. */
  namedDays: number
  /** True while the span is named for its travel, which any trip piece of its own outranks. */
  namedForTravel: boolean
  /** True while its anchor came from travel, which a trip piece of its own replaces. */
  anchorIsTravel: boolean
}

function pieceOf(event: KindedEvent): Piece {
  const words = event.kind === 'holiday' ? holidayNames(event.title) : occasionWords(event.title)
  const role = event.kind === 'trip' ? tripRoleOf(event.title) : 'own'
  return { event, words, role, travel: role !== 'own' }
}

/** The last day a piece may start on and still join the span. */
function reachOf(span: EventSpan): IsoDate {
  return JOINS_NEXT_DAY[span.kind] ? addDays(span.endsOn, 1) : span.endsOn
}

/**
 * How well a piece fits a span: a birthday, wedding, show or holiday names
 * every word the span's first named piece does, or one of the two names
 * nothing ("Birthday dinner"). Trips follow their own rules (tripPieces.ts).
 */
function fitOf(building: Building, piece: Piece): Fit {
  const { span } = building
  if (span.kind !== piece.event.kind || piece.event.startsOn > reachOf(span)) return 'none'
  if (span.kind === 'trip') return tripFit(building, piece)
  if (!sameOccasion(building.anchor, piece.words)) return 'none'
  return sharesWord(building.anchor, piece.words) ? 'named' : 'fits'
}

/**
 * The span a piece joins, if any: the one it names, else the first it fits.
 * A piece naming nothing ("Birthday dinner", "Flight home") belongs to one of
 * the spans it fits, never to an occasion of its own, which would set aside
 * twice: a way home joins the trip whose days it follows, anything else the
 * first span it fits.
 */
function homeOf(open: Building[], piece: Piece): Building | undefined {
  const fits = open.filter((building) => fitOf(building, piece) !== 'none')
  if (!piece.words.size) {
    const tripHome = fits.find(
      (building) => building.span.kind === 'trip' && followsTrip(building, piece),
    )
    return tripHome ?? fits[0]
  }
  return fits.find((building) => fitOf(building, piece) === 'named') ?? fits[0]
}

function startSpan(piece: Piece): Building {
  const { event } = piece
  return {
    span: { ...event, id: `${event.uid} ${event.startsOn}` },
    anchor: piece.words,
    anchorIsTravel: piece.travel,
    ownEnd: piece.travel ? null : event.endsOn,
    stayEnd: piece.role === 'transport' ? null : event.endsOn,
    stayFrom: piece.role === 'lodging' ? event.startsOn : null,
    namedDays: daysOf(event),
    namedForTravel: piece.travel,
  }
}

function addPiece(building: Building, piece: Piece): void {
  const { span } = building
  const { event, words, travel, role } = piece
  span.endsOn = maxDate(span.endsOn, event.endsOn)
  if (role === 'own') building.ownEnd = maxDate(building.ownEnd ?? event.endsOn, event.endsOn)
  if (role !== 'transport')
    building.stayEnd = maxDate(building.stayEnd ?? event.endsOn, event.endsOn)
  if (role === 'lodging')
    building.stayFrom = minDate(building.stayFrom ?? event.startsOn, event.startsOn)
  // The first piece naming the occasion says what it is about; a trip's own
  // piece says it better than its travel ("Lisbon and Porto trip" over "Flight to Lisbon").
  if (words.size && (!building.anchor.size || (building.anchorIsTravel && !travel))) {
    building.anchor = words
    building.anchorIsTravel = travel
  }
  const outranks = building.namedForTravel && !travel
  if (outranks || (travel === building.namedForTravel && daysOf(event) > building.namedDays)) {
    span.title = event.title
    building.namedDays = daysOf(event)
    building.namedForTravel = travel
  }
}

/**
 * The order pieces are placed in: soonest first, then on one day a trip's
 * own pieces before its travel, named pieces before ones naming nothing and
 * longer before shorter, so each of the day's occasions is open before what
 * might belong to it arrives ("Italy vacation" before the "Florence day trip"
 * within it). The sort is stable, so ties keep the calendar's own order.
 */
function byPlacing(a: Piece, b: Piece): number {
  return (
    a.event.startsOn.localeCompare(b.event.startsOn) ||
    Number(a.travel) - Number(b.travel) ||
    Number(!a.words.size) - Number(!b.words.size) ||
    daysOf(b.event) - daysOf(a.event)
  )
}

/**
 * Events merged into one span per occasion, soonest first (then by kind and
 * id, so the order never shifts between reads), each called by its longest
 * event's title, a trip's own over its travel. Pieces of one occasion are the
 * same kind and touch (overlap, or the next day for kinds that run over
 * days); fitOf and tripFit say what else.
 */
export function mergeSpans(events: KindedEvent[]): EventSpan[] {
  const pieces = events.map(pieceOf).sort(byPlacing)
  const spans: Building[] = []
  // Spans a later piece can still reach: since pieces come soonest first, one
  // whose reach is behind the piece being placed is finished for good.
  let open: Building[] = []
  for (const piece of pieces) {
    open = open.filter((building) => reachOf(building.span) >= piece.event.startsOn)
    const home = homeOf(open, piece)
    if (home) addPiece(home, piece)
    else {
      const building = startSpan(piece)
      spans.push(building)
      open.push(building)
    }
  }
  return spans
    .map((building) => building.span)
    .sort(
      (a, b) =>
        a.startsOn.localeCompare(b.startsOn) ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    )
}
