// mergeSpans for trips: a trip written as several events (the trip, its
// flights, its hotel) becomes one, travel alone never makes a second trip
// beside the real one, and travel never bridges two trips into one.

import { describe, expect, it } from 'vitest'
import { mergeSpans, type KindedEvent } from '../src/domain/calendar/spans.js'

/** A trip for these tests; its title doubles as its calendar id. */
const trip = (title: string, startsOn: string, endsOn = startsOn): KindedEvent => ({
  uid: title,
  kind: 'trip',
  title,
  startsOn,
  endsOn,
})

/** The spans as [kind, title, first day, last day], for reading at a glance. */
const merged = (...events: KindedEvent[]) =>
  mergeSpans(events).map((span) => [span.kind, span.title, span.startsOn, span.endsOn])

describe('mergeSpans with trips and their travel', () => {
  it('merges a trip with its flight and hotel, named for its longest event', () => {
    expect(
      merged(
        trip('Flight to Rome', '2026-12-09'),
        trip('Hotel Rome', '2026-12-10', '2026-12-13'),
        trip('Rome trip', '2026-12-10', '2026-12-14'),
        trip('Flight home', '2026-12-15'),
        trip('Ski weekend', '2026-12-20', '2026-12-21'),
      ),
    ).toEqual([
      ['trip', 'Rome trip', '2026-12-09', '2026-12-15'],
      ['trip', 'Ski weekend', '2026-12-20', '2026-12-21'],
    ])
  })

  it('names a trip for its own event over a longer hotel booking', () => {
    expect(
      merged(
        trip('Hotel Rome', '2026-12-09', '2026-12-14'),
        trip('Rome trip', '2026-12-10', '2026-12-12'),
      ),
    ).toEqual([['trip', 'Rome trip', '2026-12-09', '2026-12-14']])
  })

  it('keeps two trips each named for itself apart, back to back or overlapping', () => {
    expect(
      merged(
        trip('Trip to Rome', '2027-01-02', '2027-01-08'),
        trip('Ski trip', '2027-01-09', '2027-01-11'),
        trip("Mom's trip to Florida", '2027-02-01', '2027-02-07'),
        trip('Camping trip', '2027-02-05', '2027-02-08'),
      ),
    ).toEqual([
      ['trip', 'Trip to Rome', '2027-01-02', '2027-01-08'],
      ['trip', 'Ski trip', '2027-01-09', '2027-01-11'],
      ['trip', "Mom's trip to Florida", '2027-02-01', '2027-02-07'],
      ['trip', 'Camping trip', '2027-02-05', '2027-02-08'],
    ])
  })

  it('never lets the flight home bridge into the next trip', () => {
    expect(
      merged(
        trip('Trip to Rome', '2026-12-02', '2026-12-08'),
        trip('Flight to Denver', '2026-12-09'),
        trip('Ski trip', '2026-12-09', '2026-12-11'),
      ),
    ).toEqual([
      ['trip', 'Trip to Rome', '2026-12-02', '2026-12-09'],
      ['trip', 'Ski trip', '2026-12-09', '2026-12-11'],
    ])
  })

  it('gives travel naming a place to the trip going there', () => {
    // On the day both are open, the flight goes to the trip it names.
    expect(
      merged(
        trip('Trip to Rome', '2026-12-02', '2026-12-08'),
        trip('Flight to Denver', '2026-12-09'),
        trip('Denver ski trip', '2026-12-09', '2026-12-11'),
      ),
    ).toEqual([
      ['trip', 'Trip to Rome', '2026-12-02', '2026-12-08'],
      ['trip', 'Denver ski trip', '2026-12-09', '2026-12-11'],
    ])
  })

  it('keeps travel to one place apart from travel to the next', () => {
    expect(
      merged(
        trip('Flight to Chicago', '2027-02-01'),
        trip('Hotel Chicago', '2027-02-01', '2027-02-02'),
        trip('Flight to Maui', '2027-02-03'),
        trip('Maui vacation', '2027-02-03', '2027-02-08'),
      ),
    ).toEqual([
      ['trip', 'Hotel Chicago', '2027-02-01', '2027-02-02'],
      ['trip', 'Maui vacation', '2027-02-03', '2027-02-08'],
    ])
  })

  it('joins a flight the day before a trip to it, and the flight home wherever it says', () => {
    expect(
      merged(
        trip('Flight to Lisbon', '2027-03-01'),
        trip('Lisbon and Porto trip', '2027-03-02', '2027-03-06'),
        trip('Flight to Denver', '2027-03-07'),
        trip('Flight out', '2027-04-01'),
        trip('Portugal trip', '2027-04-02', '2027-04-05'),
      ),
    ).toEqual([
      ['trip', 'Lisbon and Porto trip', '2027-03-01', '2027-03-07'],
      ['trip', 'Portugal trip', '2027-04-01', '2027-04-05'],
    ])
  })

  it('joins travel during a trip to it, wherever it says it goes', () => {
    expect(
      merged(
        trip('Italy vacation', '2027-01-02', '2027-01-10'),
        trip('Flight to Florence', '2027-01-05'),
      ),
    ).toEqual([['trip', 'Italy vacation', '2027-01-02', '2027-01-10']])
  })

  it('joins trips that overlap or touch when they name the same place, or one names nowhere', () => {
    expect(
      merged(
        trip('Italy vacation', '2027-01-02', '2027-01-10'),
        trip('Day trip', '2027-01-05'),
        trip('Lisbon trip', '2027-02-01', '2027-02-03'),
        trip('Lisbon getaway, part two', '2027-02-04', '2027-02-05'),
      ),
    ).toEqual([
      ['trip', 'Italy vacation', '2027-01-02', '2027-01-10'],
      ['trip', 'Lisbon trip', '2027-02-01', '2027-02-05'],
    ])
  })

  it('makes one trip of a flight and the trip the day after it, whatever each names', () => {
    expect(
      merged(
        trip('Flight to Lisbon', '2026-12-09'),
        trip('Portugal vacation', '2026-12-10', '2026-12-14'),
        trip('Flight to Rome', '2027-01-09'),
        trip('Italy vacation', '2027-01-10', '2027-01-14'),
        trip('Flight DEN to ORD', '2027-02-09'),
        trip('London trip', '2027-02-10', '2027-02-14'),
        trip('Flight to Chicago', '2027-03-01'),
        trip('Vacation in Maui', '2027-03-02', '2027-03-06'),
      ),
    ).toEqual([
      ['trip', 'Portugal vacation', '2026-12-09', '2026-12-14'],
      ['trip', 'Italy vacation', '2027-01-09', '2027-01-14'],
      ['trip', 'London trip', '2027-02-09', '2027-02-14'],
      ['trip', 'Vacation in Maui', '2027-03-01', '2027-03-06'],
    ])
  })

  it('makes one trip of a night on the way and the trip after it', () => {
    // A night's stay written as one whole day before the trip, or as a timed booking checking out its first day.
    expect(
      merged(
        trip('Hotel near airport', '2027-04-01'),
        trip('Japan trip', '2027-04-02', '2027-04-10'),
        trip('Airport hotel', '2027-05-01', '2027-05-02'),
        trip('Peru trip', '2027-05-02', '2027-05-09'),
      ),
    ).toEqual([
      ['trip', 'Japan trip', '2027-04-01', '2027-04-10'],
      ['trip', 'Peru trip', '2027-05-01', '2027-05-09'],
    ])
  })

  it('makes one trip of a calendar filled from bookings: the flights and a hotel, no trip event', () => {
    expect(
      merged(
        trip('Flight to Seattle', '2027-10-10'),
        trip('Hotel Seattle', '2027-10-10', '2027-10-13'),
        trip('Flight to Denver', '2027-10-14'),
      ),
    ).toEqual([['trip', 'Hotel Seattle', '2027-10-10', '2027-10-14']])
  })

  it('keeps a stay of its own apart from the trip after it', () => {
    // More than a night, or ending before the next trip starts: a trip in itself.
    expect(
      merged(
        trip('Hotel Rome', '2026-12-02', '2026-12-08'),
        trip('Ski trip', '2026-12-09', '2026-12-11'),
        trip('Hotel Austin', '2027-08-01', '2027-08-03'),
        trip('Hotel Dallas', '2027-08-04', '2027-08-06'),
      ),
    ).toEqual([
      ['trip', 'Hotel Rome', '2026-12-02', '2026-12-08'],
      ['trip', 'Ski trip', '2026-12-09', '2026-12-11'],
      ['trip', 'Hotel Austin', '2027-08-01', '2027-08-03'],
      ['trip', 'Hotel Dallas', '2027-08-04', '2027-08-06'],
    ])
  })

  it('gives a flight home naming nowhere to the trip whose days it follows', () => {
    expect(
      merged(
        trip('Chicago work trip', '2026-12-08', '2026-12-10'),
        trip('Flight home', '2026-12-11'),
        trip('Maui vacation', '2026-12-11', '2026-12-18'),
        trip('Trip to Rome', '2027-02-02', '2027-02-08'),
        trip('Flight home', '2027-02-09'),
        trip('Ski trip', '2027-02-09', '2027-02-11'),
      ),
    ).toEqual([
      ['trip', 'Chicago work trip', '2026-12-08', '2026-12-11'],
      ['trip', 'Maui vacation', '2026-12-11', '2026-12-18'],
      ['trip', 'Trip to Rome', '2027-02-02', '2027-02-09'],
      ['trip', 'Ski trip', '2027-02-09', '2027-02-11'],
    ])
  })

  it('never lets a flight home the day the next trip starts bridge the two', () => {
    expect(
      merged(
        trip('Rome trip', '2027-04-02', '2027-04-06'),
        trip('Flight to Denver', '2027-04-07'),
        trip('Ski trip Vail', '2027-04-07', '2027-04-10'),
      ),
    ).toEqual([
      ['trip', 'Rome trip', '2027-04-02', '2027-04-07'],
      ['trip', 'Ski trip Vail', '2027-04-07', '2027-04-10'],
    ])
  })

  it('takes a trip held wholly within another trip’s days as part of it', () => {
    expect(
      merged(
        trip('Flight to Rome', '2027-04-01'),
        trip('Italy vacation', '2027-04-02', '2027-04-12'),
        trip('Florence day trip', '2027-04-06'),
        trip('Flight home', '2027-04-13'),
        trip('Grandma lake house trip', '2027-07-01', '2027-07-10'),
        trip('Kids camping trip', '2027-07-04', '2027-07-06'),
        // Listed first and starting the same day, the day trip still falls within the vacation.
        trip('Siena day trip', '2027-09-02'),
        trip('Tuscany vacation', '2027-09-02', '2027-09-09'),
      ),
    ).toEqual([
      ['trip', 'Italy vacation', '2027-04-01', '2027-04-13'],
      ['trip', 'Grandma lake house trip', '2027-07-01', '2027-07-10'],
      ['trip', 'Tuscany vacation', '2027-09-02', '2027-09-09'],
    ])
  })

  it('keeps back-to-back trips naming nowhere as two, and one written twice as one', () => {
    expect(
      merged(
        trip('Weekend getaway', '2027-04-02', '2027-04-04'),
        trip('Weekend getaway', '2027-04-05', '2027-04-07'),
        { ...trip('Vacation', '2027-06-01', '2027-06-05'), uid: 'work calendar' },
        { ...trip('Vacation', '2027-06-01', '2027-06-05'), uid: 'home calendar' },
      ),
    ).toEqual([
      ['trip', 'Weekend getaway', '2027-04-02', '2027-04-04'],
      ['trip', 'Weekend getaway', '2027-04-05', '2027-04-07'],
      ['trip', 'Vacation', '2027-06-01', '2027-06-05'],
    ])
  })
})
