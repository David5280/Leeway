// mergeSpans for trips written only as flights: a flight out and a flight
// back with nothing between, a flight out whose return was never written
// down, weekly work flights and the legs of a connection (flightPairs.ts).

import { describe, expect, it } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { returnDays, RETURN_WAIT_DAYS } from '../src/domain/calendar/flightPairs.js'
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
  it('leaves a lone flight out alone when the next trip is a flight out and back', () => {
    // In New York with no flight home written, then Chicago and home.
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Flight to Chicago', '2027-03-20'),
        trip('Flight to Denver', '2027-03-23'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-01'],
      ['Flight to Chicago', '2027-03-20', '2027-03-23'],
    ])
    expect(
      merged(
        trip('Flight to NYC', '2027-03-01'),
        trip('Flight to LA', '2027-03-10'),
        trip('Flight to Denver', '2027-03-14'),
      ),
    ).toEqual([
      ['Flight to NYC', '2027-03-01', '2027-03-01'],
      ['Flight to LA', '2027-03-10', '2027-03-14'],
    ])
  })

  it('pairs weekly work flights week by week', () => {
    expect(
      merged(
        trip('Flight to SFO', '2027-03-01'),
        trip('Flight to DEN', '2027-03-03'),
        trip('Flight to SFO', '2027-03-08'),
        trip('Flight to DEN', '2027-03-10'),
        trip('Flight to SFO', '2027-03-15'),
        trip('Flight to DEN', '2027-03-17'),
      ),
    ).toEqual([
      ['Flight to SFO', '2027-03-01', '2027-03-03'],
      ['Flight to SFO', '2027-03-08', '2027-03-10'],
      ['Flight to SFO', '2027-03-15', '2027-03-17'],
    ])
  })

  it('keeps each leg of a connection, out and back, with its trip', () => {
    expect(
      merged(
        trip('Flight to ORD', '2027-03-01'),
        trip('Flight to LHR', '2027-03-01'),
        trip('Flight to ORD', '2027-03-08'),
        trip('Flight to DEN', '2027-03-08'),
      ),
    ).toEqual([['Flight to ORD', '2027-03-01', '2027-03-08']])
  })
})

describe('returnDays', () => {
  const flight = (startsOn: string, named = true) => ({ startsOn, named })

  it('pairs the latest flights first, each day at most once', () => {
    const flights = [flight('2027-03-01'), flight('2027-03-20'), flight('2027-03-23')]
    expect([...returnDays(flights, new Set())]).toEqual([['2027-03-20', '2027-03-23']])
    // Two legs on one day are one flight day.
    const legs = [flight('2027-03-01'), flight('2027-03-01'), flight('2027-03-05')]
    expect([...returnDays(legs, new Set())]).toEqual([['2027-03-01', '2027-03-05']])
  })

  it('pairs nothing across a trip starting, or over RETURN_WAIT_DAYS apart', () => {
    const flights = [flight('2027-03-01'), flight('2027-03-09')]
    // A trip starting the day after the later flight makes it that trip's way out.
    expect(returnDays(flights, new Set(['2027-03-10'])).size).toBe(0)
    expect(returnDays(flights, new Set(['2027-03-05'])).size).toBe(0)
    expect(returnDays(flights, new Set(['2027-03-11'])).size).toBe(1)
    const apart = [flight('2027-03-01'), flight(addDays('2027-03-01', RETURN_WAIT_DAYS + 1))]
    expect(returnDays(apart, new Set()).size).toBe(0)
  })

  it('never pairs a way home naming nowhere with a flight naming somewhere after it', () => {
    expect(returnDays([flight('2027-03-01', false), flight('2027-03-04')], new Set()).size).toBe(0)
    expect(returnDays([flight('2027-03-01'), flight('2027-03-04', false)], new Set()).size).toBe(1)
  })
})
