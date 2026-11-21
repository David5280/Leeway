import { describe, expect, it } from 'vitest'
import { dayRange, weekLabel } from './calendar'

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
})
