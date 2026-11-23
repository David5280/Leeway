// Which trip each budget belongs to (assignBudgets), in pure terms: a budget
// finds its trip by the trip's calendar events wherever they moved, falls
// back to the days only when those events are gone, and budgets and trips
// pair one to one, so trips back to back keep a budget each.

import { describe, expect, it } from 'vitest'
import { assignBudgets, sharedDays, UID_REACH_DAYS } from '../src/domain/trips/match.js'
import { addDays } from '../src/lib/dates.js'

const trip = (uid: string, startsOn: string, endsOn: string) => ({
  uids: [uid],
  startsOn,
  endsOn,
})
const budget = (name: string, uids: string[], startsOn: string, endsOn: string) => ({
  name,
  eventUids: uids,
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
    const far = trip('rome', addDays('2026-12-10', UID_REACH_DAYS + 7), '2027-06-20')
    const sameDays = trip('ski', '2026-12-10', '2026-12-14')
    // Its event is there, too far to be this trip moved, so the trip on its old days is not it either.
    expect(assigned([rome], [sameDays, far])).toEqual([null, null])
  })

  it('takes a repeating event’s nearest time, not one a year on', () => {
    const ski = budget('Ski', ['ski'], '2026-12-10', '2026-12-14')
    const thisYear = trip('ski', '2026-12-12', '2026-12-16')
    const nextYear = trip('ski', '2027-12-10', '2027-12-14')
    expect(assigned([ski], [nextYear, thisYear])).toEqual([null, 'Ski'])
    expect(assigned([ski], [nextYear])).toEqual([null])
  })

  it('pairs one to one: two budgets never share a trip', () => {
    const first = budget('First', ['rome'], '2026-12-10', '2026-12-14')
    const second = budget('Second', ['gone'], '2026-12-10', '2026-12-14')
    expect(assigned([second, first], [ROME])).toEqual(['First'])
  })
})
