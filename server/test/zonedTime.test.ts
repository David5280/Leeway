import { describe, expect, it } from 'vitest'
import { zonedInstant } from '../src/lib/zonedTime.js'

const at = (date: string, hour: number, zone: string) =>
  zonedInstant(date, hour, zone).toISOString()

describe('zonedInstant', () => {
  it('reads an hour on the wall clock of the zone', () => {
    expect(at('2026-11-23', 8, 'America/Denver')).toBe('2026-11-23T15:00:00.000Z')
    expect(at('2026-07-06', 8, 'America/Denver')).toBe('2026-07-06T14:00:00.000Z')
    expect(at('2026-11-23', 8, 'UTC')).toBe('2026-11-23T08:00:00.000Z')
  })

  it('handles zones ahead of UTC, including half hours, across midnight', () => {
    expect(at('2026-11-23', 0, 'Asia/Kolkata')).toBe('2026-11-22T18:30:00.000Z')
    expect(at('2026-11-23', 8, 'Pacific/Auckland')).toBe('2026-11-22T19:00:00.000Z')
  })

  it('gives the first of an hour that happens twice when clocks go back', () => {
    // Denver goes from 2 AM MDT back to 1 AM MST on Nov 1, 2026.
    expect(at('2026-11-01', 1, 'America/Denver')).toBe('2026-11-01T07:00:00.000Z')
    expect(at('2026-11-01', 2, 'America/Denver')).toBe('2026-11-01T09:00:00.000Z')
  })

  it('moves an hour that never happens to the moment clocks jump forward', () => {
    // Denver jumps from 2 AM to 3 AM on Mar 8, 2026, so 2 AM is 3 AM MDT.
    expect(at('2026-03-08', 2, 'America/Denver')).toBe('2026-03-08T09:00:00.000Z')
    expect(at('2026-03-08', 3, 'America/Denver')).toBe('2026-03-08T09:00:00.000Z')
    // London jumps from 1 AM to 2 AM on Mar 29, 2026.
    expect(at('2026-03-29', 1, 'Europe/London')).toBe('2026-03-29T01:00:00.000Z')
    // Lord Howe moves only half an hour: 2 AM becomes 2:30 AM.
    expect(at('2026-10-04', 2, 'Australia/Lord_Howe')).toBe('2026-10-03T15:30:00.000Z')
  })
})
