// mergeSpans for birthdays, weddings, shows and holidays, and the words it
// reads from titles: one occasion written as several events becomes one
// span, and two occasions never become one. Trips are in calendarTrips.test.ts.

import { describe, expect, it } from 'vitest'
import { holidayNames, occasionWords, tripRoleOf } from '../src/domain/calendar/occasions.js'
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

  it('joins a piece naming nothing to one occasion, never making one of its own', () => {
    // "Opera night" is that night's show; beside two shows it joins one, rather than be a third.
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
      ['show', 'Hamilton tickets', '2026-12-10', '2026-12-10'],
      ['show', 'Tosca tickets', '2026-12-10', '2026-12-10'],
    ])
    // Two birthdays and a dinner that day are two gifts, not three.
    expect(
      merged(
        event('birthday', "Alice's birthday", '2026-12-05'),
        event('birthday', "Bob's birthday", '2026-12-05'),
        event('birthday', 'Birthday dinner', '2026-12-05'),
      ),
    ).toEqual([
      ['birthday', "Alice's birthday", '2026-12-05', '2026-12-05'],
      ['birthday', "Bob's birthday", '2026-12-05', '2026-12-05'],
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

describe('tripRoleOf', () => {
  it('tells getting there and a stay from the trip itself', () => {
    expect(tripRoleOf('Flight to Rome')).toBe('transport')
    expect(tripRoleOf('✈ UA 123 DEN→SFO')).toBe('transport')
    expect(tripRoleOf('Check in for flight to Lisbon')).toBe('transport')
    expect(tripRoleOf('Hotel Rome')).toBe('lodging')
    expect(tripRoleOf('Airbnb in Lisbon')).toBe('lodging')
    expect(tripRoleOf('Check-in: Hotel Arts')).toBe('lodging')
    expect(tripRoleOf('Rome trip')).toBe('own')
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
