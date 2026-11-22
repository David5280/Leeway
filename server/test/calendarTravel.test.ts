// mergeSpans for trips written mostly as travel: a hotel booked around the
// trip, a flight out and a flight back with nothing between, an early flight
// after a night at the airport, and a stay somewhere else right after a trip.

import { describe, expect, it } from 'vitest'
import { mergeSpans, type KindedEvent } from '../src/domain/calendar/spans.js'

/** A trip for these tests; its title doubles as its calendar id. */
const trip = (title: string, startsOn: string, endsOn = startsOn): KindedEvent => ({
  uid: `${title} ${startsOn}`,
  kind: 'trip',
  title,
  startsOn,
  endsOn,
})

/** The spans as [title, first day, last day], for reading at a glance. */
const merged = (...events: KindedEvent[]) =>
  mergeSpans(events).map((span) => [span.title, span.startsOn, span.endsOn])

describe('trips booked around their hotel', () => {
  it('joins a trip starting during a hotel stay checked into the day before', () => {
    expect(
      merged(
        trip('Flight to ORD', '2027-03-01'),
        trip('Hyatt Regency hotel', '2027-03-01', '2027-03-04'),
        trip('Chicago work trip', '2027-03-02', '2027-03-04'),
        trip('Flight home', '2027-03-05'),
      ),
    ).toEqual([['Chicago work trip', '2027-03-01', '2027-03-05']])
    expect(
      merged(
        trip('Marriott hotel', '2027-04-01', '2027-04-05'),
        trip('Vegas trip', '2027-04-02', '2027-04-05'),
      ),
    ).toEqual([['Vegas trip', '2027-04-01', '2027-04-05']])
  })

  it('takes a conference written as its travel, hotel and the conference as one trip', () => {
    expect(
      merged(
        trip('Flight to SFO', '2027-03-01'),
        trip('Hotel SF', '2027-03-01', '2027-03-04'),
        trip('ReactConf travel', '2027-03-02', '2027-03-04'),
        trip('Flight home', '2027-03-05'),
      ),
    ).toEqual([['ReactConf travel', '2027-03-01', '2027-03-05']])
  })

  it('still keeps a stay that ends before the next trip apart from it', () => {
    expect(
      merged(
        trip('Hotel Chicago', '2027-02-01', '2027-02-02'),
        trip('Maui vacation', '2027-02-03', '2027-02-08'),
      ),
    ).toEqual([
      ['Hotel Chicago', '2027-02-01', '2027-02-02'],
      ['Maui vacation', '2027-02-03', '2027-02-08'],
    ])
  })
})

describe('trips written only as flights', () => {
  it('makes one trip of a flight out and the flight back, whatever the second names', () => {
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Flight to DEN', '2027-03-04'),
        trip('Flight', '2027-05-01'),
        trip('Flight', '2027-05-04'),
        trip('Flight to Boston', '2027-07-01'),
        trip('Flight home', '2027-07-04'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-04'],
      ['Flight', '2027-05-01', '2027-05-04'],
      ['Flight to Boston', '2027-07-01', '2027-07-04'],
    ])
  })

  it('leaves a lone flight a day’s trip, and a flight back over 30 days later apart', () => {
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Flight to Austin', '2027-06-01'),
        trip('Flight home', '2027-07-02'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-01'],
      ['Flight to Austin', '2027-06-01', '2027-06-01'],
      ['Flight home', '2027-07-02', '2027-07-02'],
    ])
  })

  it('stops waiting for the flight back once another trip comes', () => {
    // The flight home after Rome is Rome's, not the flight to New York's return.
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Rome trip', '2027-03-10', '2027-03-15'),
        trip('Flight home', '2027-03-16'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-01'],
      ['Rome trip', '2027-03-10', '2027-03-16'],
    ])
  })

  it('never takes the way out to a trip as the flight back from an earlier one', () => {
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Flight', '2027-03-09'),
        trip('Ski trip', '2027-03-10', '2027-03-12'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-01'],
      ['Ski trip', '2027-03-09', '2027-03-12'],
    ])
  })
})

describe('the flight home a few days after a trip', () => {
  it('joins a flight naming nowhere to the trip that ended a day or two before', () => {
    expect(
      merged(trip('Rome trip', '2027-03-01', '2027-03-05'), trip('Flight home', '2027-03-07')),
    ).toEqual([['Rome trip', '2027-03-01', '2027-03-07']])
  })

  it('gives it to the latest of two trips it follows', () => {
    expect(
      merged(
        trip('Lake weekend', '2027-03-01', '2027-03-04'),
        trip('Napa trip', '2027-03-05', '2027-03-06'),
        trip('Flight home', '2027-03-07'),
      ),
    ).toEqual([
      ['Lake weekend', '2027-03-01', '2027-03-04'],
      ['Napa trip', '2027-03-05', '2027-03-07'],
    ])
  })

  it('leaves a flight to the next trip, or one long after, apart from the trip before', () => {
    expect(
      merged(
        trip('Rome trip', '2027-03-01', '2027-03-05'),
        trip('Flight', '2027-03-07'),
        trip('Ski trip', '2027-03-08', '2027-03-10'),
        trip('Paris trip', '2027-05-01', '2027-05-05'),
        trip('Flight home', '2027-05-09'),
      ),
    ).toEqual([
      ['Rome trip', '2027-03-01', '2027-03-05'],
      ['Ski trip', '2027-03-07', '2027-03-10'],
      ['Paris trip', '2027-05-01', '2027-05-05'],
      ['Flight home', '2027-05-09', '2027-05-09'],
    ])
  })
})

describe('a night at the airport before an early flight', () => {
  it('makes one trip of the airport hotel, the flight and the trip', () => {
    expect(
      merged(
        trip('Airport hotel', '2027-04-01'),
        trip('Flight to Tokyo', '2027-04-02'),
        trip('Japan trip', '2027-04-03', '2027-04-10'),
      ),
    ).toEqual([['Japan trip', '2027-04-01', '2027-04-10']])
  })
})

describe('a stay somewhere else right after a trip', () => {
  it('starts a trip of its own for a hotel naming another place', () => {
    expect(
      merged(
        trip('Rome trip', '2027-03-01', '2027-03-05'),
        trip('Flight to Denver', '2027-03-06'),
        trip('Hotel Vail', '2027-03-06', '2027-03-08'),
        trip('Lisbon trip', '2027-05-01', '2027-05-05'),
        trip('Hotel Paris', '2027-05-06', '2027-05-09'),
      ),
    ).toEqual([
      ['Rome trip', '2027-03-01', '2027-03-06'],
      ['Hotel Vail', '2027-03-06', '2027-03-08'],
      ['Lisbon trip', '2027-05-01', '2027-05-05'],
      ['Hotel Paris', '2027-05-06', '2027-05-09'],
    ])
  })

  it('gives the flight there to the stay it names, not the trip before', () => {
    expect(
      merged(
        trip('Rome trip', '2027-03-01', '2027-03-05'),
        trip('Flight to Paris', '2027-03-06'),
        trip('Hotel Paris', '2027-03-06', '2027-03-09'),
      ),
    ).toEqual([
      ['Rome trip', '2027-03-01', '2027-03-05'],
      ['Hotel Paris', '2027-03-06', '2027-03-09'],
    ])
  })

  it('starts a trip of its own for a hotel naming nowhere after a flight somewhere else', () => {
    expect(
      merged(
        trip('Rome trip', '2027-03-01', '2027-03-05'),
        trip('Flight to Denver', '2027-03-06'),
        trip('Hotel', '2027-03-06', '2027-03-08'),
      ),
    ).toEqual([
      ['Rome trip', '2027-03-01', '2027-03-06'],
      ['Hotel', '2027-03-06', '2027-03-08'],
    ])
  })

  it('keeps a hotel naming nowhere, or the same place, the day after a trip with it', () => {
    expect(
      merged(
        trip('Austin trip', '2027-03-01', '2027-03-03'),
        trip('Hotel', '2027-03-04', '2027-03-06'),
        trip('Rome trip', '2027-05-01', '2027-05-05'),
        trip('Hotel Rome', '2027-05-06', '2027-05-07'),
      ),
    ).toEqual([
      ['Austin trip', '2027-03-01', '2027-03-06'],
      ['Rome trip', '2027-05-01', '2027-05-07'],
    ])
  })
})
