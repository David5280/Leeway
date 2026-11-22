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
    expect(billPath('b 1')).toBe('/plan/bills?bill=b+1')
    const trip = { title: 'Rome & Florence', date: '2026-12-10', suggestedCents: 150000 }
    expect(saveForPath(trip)).toBe(
      '/plan/goals?new=purchase&name=Rome+%26+Florence&by=2026-12-10&price=150000',
    )
    expect(saveForPath({ ...trip, suggestedCents: null })).toBe(
      '/plan/goals?new=purchase&name=Rome+%26+Florence&by=2026-12-10',
    )
  })

  it('says a run of quiet weeks in a few words', () => {
    expect(quietWeeksText(0, '2026-11-17', '2026-11-23')).toBe('Nothing due this week')
    expect(quietWeeksText(1, '2026-11-24', '2026-11-30')).toBe('Nothing due next week')
    expect(quietWeeksText(4, '2026-12-15', '2026-12-21')).toBe('Nothing due the week of Dec 15')
    expect(quietWeeksText(4, '2026-12-15', '2026-12-28')).toBe('Nothing due Dec 15 to Dec 28')
  })
})
