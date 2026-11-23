// What a usual month saves, and the level the savings rate chart reads against.

import { describe, expect, it } from 'vitest'
import { fromFirstMonth, reachedTarget, rateLevel, usualRate, type MonthRate } from './rates'

const rate = (start: string, percent: number | null, current = false): MonthRate => ({
  start,
  current,
  percent,
  savedCents: 0,
  payCents: 0,
})

describe('usualRate', () => {
  it('takes the middle finished month, so one big month does not set what usual means', () => {
    const months = [rate('2026-08-01', 9), rate('2026-09-01', 80), rate('2026-10-01', 11)]
    expect(usualRate(months)).toBe(11)
  })

  it('averages the two middle months of an even count', () => {
    expect(
      usualRate([rate('2026-09-01', 10), rate('2026-10-01', null), rate('2026-11-01', 15)]),
    ).toBe(13)
  })

  it('leaves out the month still running, and has none before a month finishes', () => {
    expect(usualRate([])).toBeNull()
    expect(usualRate([rate('2026-11-01', 40, true)])).toBeNull()
    expect(usualRate([rate('2026-10-01', 12), rate('2026-11-01', 40, true)])).toBe(12)
  })

  it('keeps a month that saved nothing it could see as unknown, not zero', () => {
    expect(usualRate([rate('2026-10-01', null), rate('2026-09-01', 90)])).toBe(90)
  })
})

describe('fromFirstMonth', () => {
  it('leaves off the months before any pay or saving was seen, but keeps later gaps', () => {
    const empty = rate('2026-08-01', null)
    const paid = { ...rate('2026-09-01', null), payCents: 100 }
    const gap = rate('2026-10-01', null)
    const now = rate('2026-11-01', null, true)
    expect(fromFirstMonth([empty, paid, gap, now])).toEqual([paid, gap, now])
    expect(fromFirstMonth([empty, now])).toEqual([now])
    expect(fromFirstMonth([])).toEqual([])
  })
})

describe('rateLevel', () => {
  const months = [rate('2026-10-01', 8)]

  it('reads against the owner’s own target when they set one', () => {
    expect(rateLevel({ months, targetPercent: 15, note: '', payEstimated: false })).toEqual({
      percent: 15,
      label: 'Your target',
    })
    expect(reachedTarget(rate('2026-10-01', 15), 15)).toBe(true)
    expect(reachedTarget(rate('2026-10-01', 14), 15)).toBe(false)
  })

  it('reads against the usual month otherwise, and never judges one short', () => {
    expect(rateLevel({ months, targetPercent: null, note: '', payEstimated: false })).toEqual({
      percent: 8,
      label: 'Usual',
    })
    expect(rateLevel({ months: [], targetPercent: null, note: '', payEstimated: false })).toBeNull()
    expect(reachedTarget(rate('2026-10-01', 90), null)).toBe(false)
    expect(reachedTarget(rate('2026-10-01', null), 5)).toBe(false)
  })
})
