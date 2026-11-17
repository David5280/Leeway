import { describe, expect, it } from 'vitest'
import { isoDaysAgo } from './dates'

describe('isoDaysAgo', () => {
  // 2026-11-18 03:00 UTC is still the evening of Nov 17 in Denver.
  const now = Date.UTC(2026, 10, 18, 3, 0)

  it('gives the date as the calendar shows it in the time zone', () => {
    expect(isoDaysAgo(0, 'UTC', now)).toBe('2026-11-18')
    expect(isoDaysAgo(0, 'America/Denver', now)).toBe('2026-11-17')
  })

  it('counts back whole days across a month end', () => {
    expect(isoDaysAgo(30, 'America/Denver', now)).toBe('2026-10-18')
  })
})
