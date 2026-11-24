import { describe, expect, it } from 'vitest'
import { tripName, tripPath } from './trips'

describe('trip words', () => {
  it('builds a trip’s address', () => {
    expect(tripPath({ startsOn: '2026-12-10', endsOn: '2026-12-14' })).toBe(
      '/goals/trips/2026-12-10/2026-12-14',
    )
  })

  it('names a trip, or travel when nothing named it', () => {
    expect(tripName({ name: 'Lisbon trip' })).toBe('Lisbon trip')
    expect(tripName({ name: null })).toBe('Travel')
  })
})
