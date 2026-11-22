// One thing in life, written as several calendar events: "Rome trip", "Flight
// to Rome" and "Hotel Rome" are one trip, and "Jo's birthday" with "Jo's bday
// dinner" is one birthday. Those pieces are merged into one span, so each
// occasion is costed and listed once. Two occasions that only share a kind
// and a day ("Alice's birthday" and "Bob's birthday") stay two, since merging
// them would set aside for one. Pure.

import { addDays, maxDate, type IsoDate } from '../../lib/dates.js'
import { daysOf, type EventKind } from './kinds.js'
import { isTravel, occasionWords, sameOccasion, sharesWord } from './occasions.js'

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
 * flight the day before a trip, a rehearsal the night before a wedding,
 * Christmas Eve and Christmas. Birthdays and shows on consecutive days are two.
 */
const JOINS_NEXT_DAY: Record<EventKind, boolean> = {
  trip: true,
  wedding: true,
  holiday: true,
  birthday: false,
  show: false,
}

/** A span being built, with what its pieces say about it so far. */
interface Building {
  span: EventSpan
  /** Every piece's words: whose, which or where. */
  words: Set<string>
  /** True while every piece is travel (a flight, a hotel), with no trip named yet. */
  travelOnly: boolean
  /** How many days the piece the span is named for covers, so the longest names it. */
  namedDays: number
}

/** One event, with what its title says about it. */
interface Piece {
  event: KindedEvent
  words: Set<string>
  travel: boolean
}

function pieceOf(event: KindedEvent): Piece {
  return { event, words: occasionWords(event.title), travel: isTravel(event.title) }
}

/** The last day a piece may start on and still join the span. */
function reachOf(span: EventSpan): IsoDate {
  return JOINS_NEXT_DAY[span.kind] ? addDays(span.endsOn, 1) : span.endsOn
}

/**
 * True when a piece starting the day after a trip is that trip's: its travel
 * (the flight home, wherever it says it goes), the trip a flight the day
 * before was booked for, or a piece naming the same place. Two trips each
 * named for itself ("Trip to Rome", then "Ski trip") stay two.
 */
function continuesTrip(building: Building, piece: Piece): boolean {
  return piece.travel || building.travelOnly || sharesWord(building.words, piece.words)
}

/** True when the piece is part of the span being built. */
function belongs(building: Building, piece: Piece): boolean {
  const { span } = building
  if (span.kind !== piece.event.kind || piece.event.startsOn > reachOf(span)) return false
  // Pieces arrive soonest first, so a piece starting on or before the span's end overlaps it.
  const overlaps = piece.event.startsOn <= span.endsOn
  if (span.kind === 'trip') return overlaps || continuesTrip(building, piece)
  return sameOccasion(building.words, piece.words)
}

function startSpan(piece: Piece): Building {
  const { event } = piece
  return {
    span: { ...event, id: `${event.uid} ${event.startsOn}` },
    words: new Set(piece.words),
    travelOnly: piece.travel,
    namedDays: daysOf(event),
  }
}

function addPiece(building: Building, piece: Piece): void {
  const { span } = building
  span.endsOn = maxDate(span.endsOn, piece.event.endsOn)
  for (const word of piece.words) building.words.add(word)
  building.travelOnly &&= piece.travel
  if (daysOf(piece.event) > building.namedDays) {
    span.title = piece.event.title
    building.namedDays = daysOf(piece.event)
  }
}

/**
 * Events merged into one span per occasion, soonest first (then by kind and
 * id, so the order never shifts between reads), each called by its
 * longest event's title. Pieces of one occasion are the same kind and touch
 * (overlap, or the next day for kinds that run over days), and besides:
 * a birthday, wedding, show or holiday names the same person or thing, or
 * one of its pieces names nothing ("Birthday dinner"); a trip overlaps, or
 * is joined by its travel or a shared place name.
 */
export function mergeSpans(events: KindedEvent[]): EventSpan[] {
  // A stable sort: events starting on one day keep the calendar's own order.
  const sorted = [...events].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  const spans: Building[] = []
  // Spans a later piece can still reach: since pieces come soonest first, one
  // whose reach is behind the piece being placed is finished for good.
  let open: Building[] = []
  for (const event of sorted) {
    const piece = pieceOf(event)
    open = open.filter((building) => reachOf(building.span) >= event.startsOn)
    const home = open.find((building) => belongs(building, piece))
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
