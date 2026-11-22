// The range a birth year may fall in, and what the retirement lens asks for
// while no age is known. Pure: no database.

import { describe, expect, it } from 'vitest'
import { birthYearAsk } from '../src/domain/profile/retirementLens.js'
import { birthYearProblem, birthYearRange, OLDEST_AGE } from '../src/domain/retirement/birthYear.js'

describe('the birth year range', () => {
  it('runs from 110 years back to this year', () => {
    expect(OLDEST_AGE).toBe(110)
    expect(birthYearRange('2026-11-19')).toEqual({ earliest: 1916, latest: 2026 })
    // The year turns on New Year's Day, not a year after the first check.
    expect(birthYearRange('2027-01-01')).toEqual({ earliest: 1917, latest: 2027 })
  })

  it('takes both ends and anything between', () => {
    for (const year of [1916, 1986, 2026]) {
      expect(birthYearProblem(year, '2026-11-19')).toBeNull()
    }
  })

  it('says why a year still to come, or too far back, is refused', () => {
    expect(birthYearProblem(2027, '2026-11-19')).toBe(
      'Use a birth year of 2026 or earlier, since 2027 is still to come.',
    )
    expect(birthYearProblem(2090, '2026-12-31')).toBe(
      'Use a birth year of 2026 or earlier, since 2090 is still to come.',
    )
    expect(birthYearProblem(1915, '2026-11-19')).toBe('Use a birth year of 1916 or later.')
    expect(birthYearProblem(1900, '2026-11-19')).toBe('Use a birth year of 1916 or later.')
  })
})

describe('what the retirement lens asks for without an age', () => {
  it('asks for the year when none is given', () => {
    expect(birthYearAsk(null)).toBe(
      'Add your birth year to see what your savings and any pension could pay.',
    )
  })

  it('asks to correct a year still to come, naming it, rather than asking for one again', () => {
    expect(birthYearAsk(2090)).toBe(
      'Your birth year is saved as 2090, which is still to come. Correct it to see what your savings and any pension could pay.',
    )
  })
})
