// mergeSpans and the words it reads from titles: one occasion written as
// several events becomes one span, and two occasions never become one.

import { describe, expect, it } from 'vitest'
import { holidayNames, occasionWords } from '../src/domain/calendar/occasions.js'
import { mergeSpans, type KindedEvent } from '../src/domain/calendar/spans.js'

/** An event for these tests; its title doubles as its calendar id. */
const event = (
  kind: KindedEvent['kind'],
  title: string,
  startsOn: string,
  endsOn = startsOn,
): KindedEvent => ({ uid: title, kind, title, startsOn, endsOn })

const trip = (title: string, startsOn: string, endsOn = startsOn) =>
  event('trip', title, startsOn, endsOn)

/** The spans as [kind, title, first day, last day], for reading at a glance. */
const merged = (...events: KindedEvent[]) =>
  mergeSpans(events).map((span) => [span.kind, span.title, span.startsOn, span.endsOn])

describe('mergeSpans', () => {
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

  it('merges back-to-back days only for kinds that run over days', () => {
    expect(
      merged(
        event('wedding', 'Wedding rehearsal dinner', '2026-06-05'),
        event('wedding', "Sam's wedding", '2026-06-06'),
        event('holiday', 'Christmas Eve', '2026-12-24'),
        event('holiday', 'Christmas', '2026-12-25'),
        event('birthday', "Jo's birthday", '2026-03-01'),
        event('birthday', "Al's birthday", '2026-03-02'),
        event('birthday', "Jo's bday dinner", '2026-03-01'),
        event('show', 'Concert', '2026-03-01'),
      ),
    ).toEqual([
      ['birthday', "Jo's birthday", '2026-03-01', '2026-03-01'],
      ['show', 'Concert', '2026-03-01', '2026-03-01'],
      ['birthday', "Al's birthday", '2026-03-02', '2026-03-02'],
      ['wedding', 'Wedding rehearsal dinner', '2026-06-05', '2026-06-06'],
      ['holiday', 'Christmas Eve', '2026-12-24', '2026-12-25'],
    ])
  })

  it('keeps two people’s birthdays on one day apart', () => {
    expect(
      merged(
        event('birthday', "Alice's birthday", '2026-12-05'),
        event('birthday', "Bob's birthday", '2026-12-05'),
      ),
    ).toEqual([
      ['birthday', "Alice's birthday", '2026-12-05', '2026-12-05'],
      ['birthday', "Bob's birthday", '2026-12-05', '2026-12-05'],
    ])
  })

  it('tells two people with one first name apart by their initials', () => {
    expect(
      merged(
        event('birthday', "Alex M's birthday", '2026-12-05'),
        event('birthday', "Alex K's birthday", '2026-12-05'),
        event('birthday', "Alex K's bday drinks", '2026-12-05'),
      ),
    ).toEqual([
      ['birthday', "Alex K's birthday", '2026-12-05', '2026-12-05'],
      ['birthday', "Alex M's birthday", '2026-12-05', '2026-12-05'],
    ])
  })

  it('matches a piece against what the occasion is about, never words gathered along the way', () => {
    // The joint dinner names Jo, so it joins Jo's birthday, but it does not make Sam's birthday Jo's.
    expect(
      merged(
        event('birthday', "Jo's birthday", '2026-03-01'),
        event('birthday', 'Jo and Sam birthday dinner', '2026-03-01'),
        event('birthday', "Sam's birthday", '2026-03-01'),
      ),
    ).toEqual([
      ['birthday', "Jo's birthday", '2026-03-01', '2026-03-01'],
      ['birthday', "Sam's birthday", '2026-03-01', '2026-03-01'],
    ])
  })

  it('keeps two shows on one night apart, and one show’s tickets with it', () => {
    expect(
      merged(
        event('show', 'Taylor Swift concert', '2026-12-10'),
        event('show', 'Hamilton tickets', '2026-12-10'),
        event('show', 'Taylor Swift tickets', '2026-12-10'),
      ),
    ).toEqual([
      ['show', 'Hamilton tickets', '2026-12-10', '2026-12-10'],
      ['show', 'Taylor Swift concert', '2026-12-10', '2026-12-10'],
    ])
  })

  it('joins a piece naming nothing only when one occasion alone could take it', () => {
    // With one show that night, "Opera night" is that show; with two, it is a guess, so it stands alone.
    expect(
      merged(
        event('show', 'Opera night', '2026-12-10'),
        event('show', 'Tosca tickets', '2026-12-10'),
      ),
    ).toEqual([['show', 'Tosca tickets', '2026-12-10', '2026-12-10']])
    expect(
      merged(
        event('show', 'Concert', '2026-12-10'),
        event('show', 'Tosca tickets', '2026-12-10'),
        event('show', 'Hamilton tickets', '2026-12-10'),
      ),
    ).toEqual([
      ['show', 'Concert', '2026-12-10', '2026-12-10'],
      ['show', 'Hamilton tickets', '2026-12-10', '2026-12-10'],
      ['show', 'Tosca tickets', '2026-12-10', '2026-12-10'],
    ])
  })

  it('never joins two couples’ weddings on consecutive days, but joins one couple’s', () => {
    expect(
      merged(
        event('wedding', "Sam & Jo's wedding", '2026-12-12'),
        event('wedding', "Pat & Lee's wedding", '2026-12-13'),
        event('wedding', "Pat & Lee's wedding brunch", '2026-12-14'),
      ),
    ).toEqual([
      ['wedding', "Sam & Jo's wedding", '2026-12-12', '2026-12-12'],
      ['wedding', "Pat & Lee's wedding", '2026-12-13', '2026-12-14'],
    ])
  })

  it('keeps a holiday one occasion, whatever else its events say', () => {
    expect(
      merged(
        event('holiday', 'Christmas Eve', '2026-12-24'),
        event('holiday', 'Christmas', '2026-12-25'),
        event('holiday', "Christmas dinner at grandma's", '2026-12-25'),
        event('holiday', 'Xmas brunch', '2026-12-26'),
        event('holiday', "New Year's Eve", '2026-12-31'),
        event('holiday', 'New Years Day', '2027-01-01'),
      ),
    ).toEqual([
      ['holiday', 'Christmas Eve', '2026-12-24', '2026-12-26'],
      ['holiday', "New Year's Eve", '2026-12-31', '2027-01-01'],
    ])
  })

  it('never merges events of different kinds on one day', () => {
    expect(
      merged(
        event('birthday', "Jo's birthday", '2026-03-01'),
        event('show', 'Jo concert', '2026-03-01'),
      ),
    ).toHaveLength(2)
  })

  it('gives each span a stable id from its first event, unique when two share a day', () => {
    const spans = mergeSpans([
      { ...event('birthday', "Bob's birthday", '2026-12-05'), uid: 'b' },
      { ...event('birthday', "Alice's birthday", '2026-12-05'), uid: 'a' },
      { ...event('birthday', "Alice's bday dinner", '2026-12-05'), uid: 'a2' },
    ])
    expect(spans.map((span) => span.id)).toEqual(['a 2026-12-05', 'b 2026-12-05'])
  })

  it('leaves the events given as they were', () => {
    const events = [trip('A', '2026-01-01'), trip('B', '2026-01-02', '2026-01-05')]
    mergeSpans(events)
    expect(events[0]).toEqual(trip('A', '2026-01-01'))
  })
})

describe('mergeSpans with trips and their travel', () => {
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

  it('keeps a flight to one place the day before a trip to another apart', () => {
    expect(
      merged(
        trip('Flight to Chicago', '2027-02-01'),
        trip('Vacation in Maui', '2027-02-02', '2027-02-06'),
      ),
    ).toEqual([
      ['trip', 'Flight to Chicago', '2027-02-01', '2027-02-01'],
      ['trip', 'Vacation in Maui', '2027-02-02', '2027-02-06'],
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

  it('leaves a flight home alone when it could be either of two trips', () => {
    expect(
      merged(
        trip('Trip to Rome', '2026-12-02', '2026-12-08'),
        trip('Flight home', '2026-12-09'),
        trip('Ski trip', '2026-12-09', '2026-12-11'),
      ),
    ).toEqual([
      ['trip', 'Trip to Rome', '2026-12-02', '2026-12-08'],
      ['trip', 'Flight home', '2026-12-09', '2026-12-09'],
      ['trip', 'Ski trip', '2026-12-09', '2026-12-11'],
    ])
  })
})

describe('occasionWords', () => {
  it('keeps the words that say whose or where, and drops the ones that say what kind', () => {
    expect([...occasionWords("Jo's bday dinner")]).toEqual(['jo'])
    expect([...occasionWords('Sam & Jo’s wedding rehearsal')]).toEqual(['sam', 'jo'])
    expect([...occasionWords('Flight to Rome ✈')]).toEqual(['rome'])
    expect([...occasionWords('A night at the opera')]).toEqual([])
  })

  it('keeps an initial, but not the letter left of "b-day"', () => {
    expect([...occasionWords("Alex M's birthday")]).toEqual(['alex', 'm'])
    expect([...occasionWords('B-day party')]).toEqual([])
    expect([...occasionWords("Mom's b'day")]).toEqual(['mom'])
  })
})

describe('holidayNames', () => {
  it('names the holiday alone, one name however it is written', () => {
    expect([...holidayNames("Christmas dinner at grandma's")]).toEqual(['christmas'])
    expect([...holidayNames('Xmas Eve')]).toEqual(['christmas'])
    expect([...holidayNames('Chanukah party')]).toEqual(['hanukkah'])
    expect([...holidayNames("New Year's Eve")]).toEqual(['new year'])
    expect([...holidayNames('Thanksgiving and Christmas shopping')]).toEqual([
      'thanksgiving',
      'christmas',
    ])
  })
})
