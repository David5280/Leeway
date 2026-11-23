// Which trip each budget belongs to (assignBudgets), in pure terms: a budget
// finds its trip by the trip's calendar events wherever they moved, a repeat
// of a repeating event by its own id, never a neighbour's; it falls back to
// the days only when those events are gone, and budgets and trips pair one
// to one, so trips back to back keep a budget each.

import { describe, expect, it } from 'vitest'
import { assignBudgets, sharedDays } from '../src/domain/trips/match.js'

/** A trip of one event; a repeat's id is its series' id and the day it was set for (eventIdOf). */
const trip = (eventId: string, startsOn: string, endsOn: string) => ({
  eventIds: [eventId],
  startsOn,
  endsOn,
})
const budget = (name: string, eventIds: string[], startsOn: string, endsOn: string) => ({
  name,
  eventIds,
  startsOn,
  endsOn,
})

/** Each trip's budget by name, in the trips' order; null for none. */
const assigned = (budgets: ReturnType<typeof budget>[], trips: ReturnType<typeof trip>[]) => {
  const byTrip = assignBudgets(budgets, trips)
  return trips.map((_, i) => byTrip.get(i)?.name ?? null)
}

const ROME = trip('rome', '2026-12-10', '2026-12-14')
const PARIS = trip('paris', '2026-12-14', '2026-12-18')

describe('sharedDays', () => {
  it('counts both ends, and nothing for days apart', () => {
    expect(sharedDays(ROME, PARIS)).toBe(1)
    expect(sharedDays(ROME, ROME)).toBe(5)
    expect(sharedDays(ROME, trip('x', '2026-12-15', '2026-12-16'))).toBe(0)
  })
})

describe('assignBudgets', () => {
  it('gives back-to-back trips sharing a travel day their own budgets', () => {
    const rome = budget('Rome', ['rome'], '2026-12-10', '2026-12-14')
    // Before, Paris took Rome's budget too, for the one day they share.
    expect(assigned([rome], [ROME, PARIS])).toEqual(['Rome', null])
    const paris = budget('Paris', ['paris'], '2026-12-14', '2026-12-18')
    expect(assigned([paris, rome], [ROME, PARIS])).toEqual(['Rome', 'Paris'])
  })

  it('follows a trip moved further than its own length', () => {
    const rome = budget('Rome', ['rome'], '2026-12-10', '2026-12-14')
    const moved = trip('rome', '2026-12-17', '2026-12-21')
    expect(assigned([rome], [moved])).toEqual(['Rome'])
  })

  it('prefers its own event to a trip on its old days', () => {
    const rome = budget('Rome', ['rome'], '2026-12-10', '2026-12-14')
    const moved = trip('rome', '2026-12-20', '2026-12-24')
    const other = trip('ski', '2026-12-10', '2026-12-14')
    expect(assigned([rome], [other, moved])).toEqual([null, 'Rome'])
  })

  it('falls back to a trip on most of its days once its own events are gone', () => {
    const rome = budget('Rome', ['old-rome'], '2026-12-10', '2026-12-14')
    // The event made again (a new id), a day later.
    expect(assigned([rome], [trip('new-rome', '2026-12-11', '2026-12-15')])).toEqual(['Rome'])
    // A trip only touching its last day is the next trip, not this one.
    expect(assigned([rome], [PARIS])).toEqual([null])
  })

  it('never falls back by days while its own event is still on the calendar', () => {
    const rome = budget('Rome', ['rome'], '2026-12-10', '2026-12-14')
    const far = trip('rome', '2027-06-15', '2027-06-20')
    const sameDays = trip('ski', '2026-12-10', '2026-12-14')
    // Its one event moved far, and it follows; the trip on its old days is another.
    expect(assigned([rome], [sameDays, far])).toEqual([null, 'Rome'])
  })

  it('stays with its own repeat of a repeating event, never a neighbour', () => {
    const december = budget('Acme', ['acme 2026-12-10'], '2026-12-10', '2026-12-12')
    const november = trip('acme 2026-11-10', '2026-11-10', '2026-11-12')
    const january = trip('acme 2027-01-10', '2027-01-10', '2027-01-12')
    // Before, every repeat shared one id, and the budget went to November's.
    expect(assigned([december], [november, january])).toEqual([null, null])
    // December's repeat moved on its own keeps its id, and the budget follows it.
    const moved = trip('acme 2026-12-10', '2027-01-25', '2027-01-27')
    expect(assigned([december], [november, january, moved])).toEqual([null, null, 'Acme'])
  })

  it('holds an id on several trips only for one sharing its days', () => {
    // Events read before repeats were told apart: every repeat has the series' id.
    const ski = budget('Ski', ['ski'], '2026-12-10', '2026-12-14')
    const thisYear = trip('ski', '2026-12-12', '2026-12-16')
    const nextYear = trip('ski', '2027-12-10', '2027-12-14')
    const yearAfter = trip('ski', '2028-12-10', '2028-12-14')
    expect(assigned([ski], [nextYear, thisYear])).toEqual([null, 'Ski'])
    expect(assigned([ski], [nextYear, yearAfter])).toEqual([null, null])
  })

  it('pairs one to one: two budgets never share a trip', () => {
    const first = budget('First', ['rome'], '2026-12-10', '2026-12-14')
    const second = budget('Second', ['gone'], '2026-12-10', '2026-12-14')
    expect(assigned([second, first], [ROME])).toEqual(['First'])
  })
})
