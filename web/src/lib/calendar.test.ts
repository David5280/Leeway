import { describe, expect, it } from 'vitest'
import { billPath, dayRange, quietWeeksText, saveForPath, weekLabel } from './calendar'

describe('calendar words', () => {
  it('names a run of days', () => {
    expect(dayRange({ startsOn: '2026-12-10', endsOn: '2026-12-14' })).toBe('Dec 10 to Dec 14')
    expect(dayRange({ startsOn: '2026-12-10', endsOn: '2026-12-10' })).toBe('Dec 10')
  })

  it('names the weeks ahead', () => {
    expect(weekLabel(0, '2026-11-17')).toBe('This week')
    expect(weekLabel(1, '2026-11-24')).toBe('Next week')
    expect(weekLabel(2, '2026-12-01')).toBe('Week of Dec 1')
  })
  it('links a bill to its form, and an event to a purchase to save for it', () => {
    expect(billPath('b 1')).toBe('/payday/bills?bill=b+1')
    const trip = { kind: 'trip' as const, date: '2026-12-10', suggestedCents: 150000 }
    expect(saveForPath(trip, '2026-11-17')).toBe(
      '/goals?new=purchase&name=Trip&by=2026-12-10&price=150000',
    )
    expect(saveForPath({ ...trip, suggestedCents: null }, '2026-11-17')).toBe(
      '/goals?new=purchase&name=Trip&by=2026-12-10',
    )
    // Nothing left to set aside prices nothing.
    expect(saveForPath({ ...trip, suggestedCents: 0 }, '2026-11-17')).not.toContain('price')
    // Starting today is wanted by today.
    expect(saveForPath(trip, '2026-12-10')).toContain('by=2026-12-10&')
  })

  it('names a purchase for an event by its kind, never a title that may name a person', () => {
    const named = (kind: Parameters<typeof saveForPath>[0]['kind']) =>
      new URLSearchParams(
        saveForPath({ kind, date: '2026-12-01', suggestedCents: 6000 }, '2026-11-17').split('?')[1],
      ).get('name')
    expect(named('birthday')).toBe('Birthday gift')
    expect(named('wedding')).toBe('Wedding')
    expect(named('trip')).toBe('Trip')
    expect(named('holiday')).toBe('Holiday')
    expect(named('show')).toBe('Show')
  })

  it('wants a purchase for an event already under way by today, never a day gone by', () => {
    const trip = { kind: 'trip' as const, date: '2026-11-15', suggestedCents: 20000 }
    expect(saveForPath(trip, '2026-11-17')).toBe(
      '/goals?new=purchase&name=Trip&by=2026-11-17&price=20000',
    )
  })

  it('says a run of quiet weeks in a few words', () => {
    expect(quietWeeksText(0, '2026-11-17', '2026-11-23')).toBe('Nothing due this week')
    expect(quietWeeksText(1, '2026-11-24', '2026-11-30')).toBe('Nothing due next week')
    expect(quietWeeksText(4, '2026-12-15', '2026-12-21')).toBe('Nothing due the week of Dec 15')
    expect(quietWeeksText(4, '2026-12-15', '2026-12-28')).toBe('Nothing due Dec 15 to Dec 28')
  })
})
