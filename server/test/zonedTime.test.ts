import { describe, expect, it } from 'vitest'
import { MAX_ZONES, perZone } from '../src/lib/zoneCache.js'
import { wallClockMs, zonedInstant } from '../src/lib/zonedTime.js'

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

describe('wallClockMs', () => {
  /** The wall clock read straight from Intl, to the second, with no remembering. */
  function fromIntl(instant: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant))
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    const { year, month, day, hour, minute, second } = {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour'),
      minute: part('minute'),
      second: part('second'),
    }
    return Date.UTC(year, month - 1, day, hour, minute, second)
  }

  it.each([
    'America/Denver',
    'America/St_Johns',
    'Europe/London',
    'Australia/Sydney',
    'Australia/Lord_Howe',
    'Pacific/Auckland',
    'Pacific/Chatham',
    'Asia/Kolkata',
    'UTC',
  ])(
    'reads the same clock as Intl in %s, hour by hour through two years of clock changes',
    (zone) => {
      // Every 50 minutes across 2025 and 2026, so each change of clocks is passed through mid-day.
      const from = Date.UTC(2025, 0, 1)
      const to = Date.UTC(2027, 0, 1)
      const wrong: string[] = []
      for (let instant = from; instant < to; instant += 50 * 60_000) {
        if (wallClockMs(instant, zone) !== fromIntl(instant, zone))
          wrong.push(new Date(instant).toISOString())
      }
      expect(wrong).toEqual([])
    },
  )

  it('reads the same clock again for an instant read before', () => {
    const instant = Date.UTC(2026, 2, 8, 9, 30)
    expect(wallClockMs(instant, 'America/Denver')).toBe(wallClockMs(instant, 'America/Denver'))
    expect(wallClockMs(instant, 'America/Denver')).toBe(Date.UTC(2026, 2, 8, 3, 30))
  })
})

describe('perZone', () => {
  it('makes an entry once per zone, and empties the map rather than grow past MAX_ZONES', () => {
    const map = new Map<string, number>()
    let made = 0
    const make = () => ++made
    expect(perZone(map, 'Asia/Tokyo', make)).toBe(1)
    expect(perZone(map, 'Asia/Tokyo', make)).toBe(1)
    for (let i = 0; i < MAX_ZONES * 3; i++) perZone(map, `Zone/${i}`, make)
    expect(map.size).toBeLessThanOrEqual(MAX_ZONES)
    expect(made).toBe(1 + MAX_ZONES * 3)
  })
})
