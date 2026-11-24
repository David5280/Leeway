// One thing in life, written as several calendar events: "Rome trip", "Flight
// to Rome" and "Hotel Rome" are one trip, and "Jo's birthday" with "Jo's bday
// dinner" is one birthday. Those pieces are merged into one span, so each
// occasion is costed and listed once. Two occasions that only share a kind
// and a day ("Alice's birthday" and "Bob's birthday") stay two, since merging
// them would set aside for one, but a piece naming nothing ("Birthday
// dinner") always joins one of them rather than make a third. Pure.

import { addDays, maxDate, minDate, type IsoDate } from '../../lib/dates.js'
import { returnDays } from './flightPairs.js'
import { eventIdOf } from './ics.js'
import { daysOf, type EventKind } from './kinds.js'
import {
  holidayNames,
  occasionWords,
  sameOccasion,
  sharesWord,
  tripRoleOf,
  type TripRole,
} from './occasions.js'
import { followsTrip, tripFit, tripReach, type Fit, type TripSoFar } from './tripPieces.js'

/** An event already sorted into a kind. */
export interface KindedEvent {
  /** The calendar's id for the event; with its first day, it tells one event from any other. */
  uid: string
  /** For a repeat of a repeating event, the day it was set for (CalendarEvent); absent or null otherwise. */
  repeatOn?: IsoDate | null
  title: string
  startsOn: IsoDate
  endsOn: IsoDate
  kind: EventKind
}

/** One occasion, made of one or more events. */
export interface EventSpan extends KindedEvent {
  /** Stable for as long as the calendar is: its first event's id and first day. */
  id: string
  /**
   * Which events were merged into it (eventIdOf), each staying the same when
   * its event moves, even a repeat moved on its own.
   */
  eventIds: string[]
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
  /** True for travel on the day a trip starts or the day before: the way out to it. */
  leadsIntoTrip: boolean
  /** For a flight, the day of the flight back paired with it (flightPairs.ts); else null. */
  returnOn: IsoDate | null
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

/** One event as a piece, given the days trips of their own start on. */
function pieceOf(event: KindedEvent, tripStarts: Set<IsoDate>): Piece {
  const words = event.kind === 'holiday' ? holidayNames(event.title) : occasionWords(event.title)
  const role = event.kind === 'trip' ? tripRoleOf(event.title) : 'own'
  const travel = role !== 'own'
  const { startsOn } = event
  const leadsIntoTrip = travel && (tripStarts.has(startsOn) || tripStarts.has(addDays(startsOn, 1)))
  return { event, words, role, travel, leadsIntoTrip, returnOn: null }
}

/** Gives each flight the day of its flight back, where one pairs with it. */
function pairFlights(pieces: Piece[], tripStarts: Set<IsoDate>): void {
  const flights = pieces.filter((piece) => piece.role === 'transport')
  const named = flights.map(({ event, words }) => ({
    startsOn: event.startsOn,
    named: words.size > 0,
  }))
  const backOn = returnDays(named, tripStarts)
  for (const flight of flights) flight.returnOn = backOn.get(flight.event.startsOn) ?? null
}

/** The days a trip's own event (not its travel) starts on. */
function tripStartsOf(events: KindedEvent[]): Set<IsoDate> {
  const own = events.filter((event) => event.kind === 'trip' && tripRoleOf(event.title) === 'own')
  return new Set(own.map((event) => event.startsOn))
}

/** The last day a piece may start on and still join the span. */
function reachOf(building: Building): IsoDate {
  const { span } = building
  if (span.kind === 'trip') return tripReach(building)
  return JOINS_NEXT_DAY[span.kind] ? addDays(span.endsOn, 1) : span.endsOn
}

/**
 * How well a piece fits a span: a birthday, wedding, show or holiday names
 * every word the span's first named piece does, or one of the two names
 * nothing ("Birthday dinner"). Trips follow their own rules (tripPieces.ts).
 */
function fitOf(building: Building, piece: Piece): Fit {
  const { span } = building
  if (span.kind !== piece.event.kind || piece.event.startsOn > reachOf(building)) return 'none'
  if (span.kind === 'trip') return tripFit(building, piece)
  if (!sameOccasion(building.anchor, piece.words)) return 'none'
  return sharesWord(building.anchor, piece.words) ? 'named' : 'fits'
}

/** Of the trips a piece of travel follows, the one whose stays end last: the trip it leaves. */
function tripLeft(fits: Building[], piece: Piece): Building | undefined {
  const followed = fits.filter(
    (building) => building.span.kind === 'trip' && followsTrip(building, piece),
  )
  const stayEnd = (building: Building) => building.stayEnd ?? ''
  return followed.reduce<Building | undefined>(
    (latest, building) => (latest && stayEnd(latest) >= stayEnd(building) ? latest : building),
    undefined,
  )
}

/**
 * The span a piece joins, if any: the one it names, else the first it fits.
 * A piece naming nothing ("Birthday dinner", "Flight home") belongs to one of
 * the spans it fits, never to an occasion of its own, which would set aside
 * twice: a way home joins the latest trip whose days it follows, anything
 * else the first span it fits.
 */
function homeOf(open: Building[], piece: Piece): Building | undefined {
  const fits = open.filter((building) => fitOf(building, piece) !== 'none')
  if (!piece.words.size) return tripLeft(fits, piece) ?? fits[0]
  return fits.find((building) => fitOf(building, piece) === 'named') ?? fits[0]
}

function startSpan(piece: Piece): Building {
  const { event } = piece
  return {
    span: { ...event, id: `${event.uid} ${event.startsOn}`, eventIds: [eventIdOf(event)] },
    anchor: piece.words,
    anchorIsTravel: piece.travel,
    ownEnd: piece.travel ? null : event.endsOn,
    stayEnd: piece.role === 'transport' ? null : event.endsOn,
    stayFrom: piece.role === 'lodging' ? event.startsOn : null,
    leftOn: piece.role === 'transport' ? event.startsOn : null,
    returnOn: piece.returnOn,
    namedDays: daysOf(event),
    namedForTravel: piece.travel,
  }
}

/** Moves a trip's own, stay and flight days on for a piece joining it. */
function markTripDays(building: Building, { event, role }: Piece): void {
  const { startsOn, endsOn } = event
  if (role === 'own') building.ownEnd = maxDate(building.ownEnd ?? endsOn, endsOn)
  if (role !== 'transport') building.stayEnd = maxDate(building.stayEnd ?? endsOn, endsOn)
  if (role === 'lodging') building.stayFrom = minDate(building.stayFrom ?? startsOn, startsOn)
  if (role === 'transport') building.leftOn = maxDate(building.leftOn ?? startsOn, startsOn)
  // A lone flight out waits until its flight back, a stay or the trip itself
  // joins it; another flight (a connection's next leg) leaves it waiting.
  const anotherFlight = role === 'transport' && startsOn !== building.returnOn
  if (!anotherFlight) building.returnOn = null
}

function addPiece(building: Building, piece: Piece): void {
  const { span } = building
  const { event, words, travel } = piece
  span.endsOn = maxDate(span.endsOn, event.endsOn)
  const eventId = eventIdOf(event)
  if (!span.eventIds.includes(eventId)) span.eventIds.push(eventId)
  markTripDays(building, piece)
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
  const tripStarts = tripStartsOf(events)
  const pieces = events.map((event) => pieceOf(event, tripStarts)).sort(byPlacing)
  pairFlights(pieces, tripStarts)
  const spans: Building[] = []
  // Spans a later piece can still reach: since pieces come soonest first, one
  // whose reach is behind the piece being placed is finished for good.
  let open: Building[] = []
  for (const piece of pieces) {
    open = open.filter((building) => reachOf(building) >= piece.event.startsOn)
    const home = homeOf(open, piece)
    if (home) addPiece(home, piece)
    else {
      const building = startSpan(piece)
      spans.push(building)
      open.push(building)
    }
    // The next trip of its own ends any lone flight's wait for its flight back.
    if (piece.event.kind === 'trip' && !piece.travel) {
      for (const building of open) building.returnOn = null
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
