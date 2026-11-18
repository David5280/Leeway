import { describe, expect, it } from 'vitest'
import {
  axisFormat,
  axisIndices,
  compactMoney,
  nearestIndex,
  niceTicks,
  spreadLabels,
  textWidth,
  timeTicks,
} from './chartScale'

const usd = { currency: 'USD', locale: 'en-US' }

describe('niceTicks', () => {
  it('uses round steps that land exactly on the top of the range', () => {
    expect(niceTicks(0, 80_000)).toEqual({
      low: 0,
      high: 80_000,
      values: [0, 20_000, 40_000, 60_000, 80_000],
    })
  })

  it('reaches past the range to the next round step, with 2.5 as a round step', () => {
    expect(niceTicks(0, 83_200).values).toEqual([0, 25_000, 50_000, 75_000, 100_000])
  })

  it('always includes zero, below a range of positive values and inside a range that crosses it', () => {
    expect(niceTicks(5_000, 9_000).values).toEqual([0, 2_500, 5_000, 7_500, 10_000])
    expect(niceTicks(-5_000, 70_000)).toEqual({
      low: -25_000,
      high: 75_000,
      values: [-25_000, 0, 25_000, 50_000, 75_000],
    })
  })

  it('keeps to the tick limit it was given', () => {
    for (const high of [1, 99, 1_234, 98_765, 4_321_000]) {
      expect(niceTicks(0, high, 4).values.length).toBeLessThanOrEqual(4)
    }
  })

  it('still draws an axis when every value is zero', () => {
    expect(niceTicks(0, 0).values).toEqual([0, 2_500, 5_000, 7_500, 10_000])
  })
})

describe('compactMoney', () => {
  it('shortens thousands and millions in the owner currency', () => {
    expect(compactMoney(1_500_000, usd)).toBe('$15K')
    expect(compactMoney(1_250_000, usd)).toBe('$12.5K')
    expect(compactMoney(120_000_000, usd)).toBe('$1.2M')
  })
})

describe('axisFormat', () => {
  it('writes whole amounts while the largest tick has four digits or fewer', () => {
    const format = axisFormat([0, 50_000, 100_000], usd)
    expect(format(75_000)).toBe('$750')
    expect(format(100_000)).toBe('$1,000')
  })

  it('shortens every tick alike once the largest reaches five digits', () => {
    const format = axisFormat([0, 500_000, 1_000_000], usd)
    expect(format(500_000)).toBe('$5K')
    expect(format(1_000_000)).toBe('$10K')
  })

  it('looks at the size of negative ticks too', () => {
    expect(axisFormat([-2_000_000, 0], usd)(-2_000_000)).toBe('-$20K')
  })
})

describe('textWidth', () => {
  it('estimates a label from its length and font size', () => {
    expect(textWidth('$1,000')).toBe(44)
    expect(textWidth('ab', 10)).toBe(12)
  })
})

describe('axisIndices', () => {
  it('labels nothing for no points and the only point for one', () => {
    expect(axisIndices(0, 5)).toEqual([])
    expect(axisIndices(1, 5)).toEqual([0])
  })

  it('labels every n-th point and always the last', () => {
    expect(axisIndices(30, 5)).toEqual([0, 8, 16, 24, 29])
    expect(axisIndices(3, 10)).toEqual([0, 1, 2])
  })

  it('drops the label before the last when the two would crowd', () => {
    expect(axisIndices(14, 5)).toEqual([0, 4, 8, 13])
  })

  it('labels both ends even when asked for fewer than two', () => {
    expect(axisIndices(5, 1)).toEqual([0, 4])
  })
})

describe('spreadLabels', () => {
  it('leaves labels that do not collide where they are', () => {
    expect(spreadLabels([40, 120], 20, 0, 200)).toEqual([40, 120])
  })

  it('pushes a crowded label down, keeping the first on its line', () => {
    expect(spreadLabels([100, 104], 20, 0, 200)).toEqual([100, 120])
  })

  it('pushes labels back up from the bottom edge, in their original order', () => {
    expect(spreadLabels([195, 190], 20, 0, 200)).toEqual([200, 180])
  })

  it('keeps labels below the top edge', () => {
    expect(spreadLabels([-10], 20, 10, 200)).toEqual([10])
    expect(spreadLabels([], 20, 0, 200)).toEqual([])
  })
})

describe('nearestIndex', () => {
  it('finds the closest position, preferring the first on a tie', () => {
    expect(nearestIndex(37, [0, 30, 60])).toBe(1)
    expect(nearestIndex(15, [0, 30])).toBe(0)
    expect(nearestIndex(15, [])).toBe(-1)
  })
})

describe('timeTicks', () => {
  it('spaces days evenly over a short span', () => {
    expect(timeTicks('2026-11-01', '2026-11-30', 5).map((t) => t.date)).toEqual([
      '2026-11-01',
      '2026-11-09',
      '2026-11-17',
      '2026-11-25',
    ])
    expect(timeTicks('2026-11-01', '2026-11-30', 5).every((t) => !t.monthly)).toBe(true)
  })

  it('labels a single day once', () => {
    expect(timeTicks('2026-11-17', '2026-11-17', 5)).toEqual([
      { date: '2026-11-17', showYear: false, monthly: false },
    ])
  })

  it('labels a year by quarters, with the year on the first and on January', () => {
    expect(timeTicks('2025-11-17', '2026-11-17', 6)).toEqual([
      { date: '2026-01-01', showYear: true, monthly: true },
      { date: '2026-04-01', showYear: false, monthly: true },
      { date: '2026-07-01', showYear: false, monthly: true },
      { date: '2026-10-01', showYear: false, monthly: true },
    ])
  })

  it('labels every month of a short history', () => {
    const ticks = timeTicks('2026-06-01', '2026-11-17', 8)
    expect(ticks.map((t) => t.date)).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ])
    expect(ticks.map((t) => t.showYear)).toEqual([true, false, false, false, false])
  })

  it('steps whole years over a long history and still keeps to the limit', () => {
    expect(timeTicks('2020-03-15', '2026-03-15', 5).map((t) => t.date)).toEqual([
      '2022-01-01',
      '2024-01-01',
      '2026-01-01',
    ])
  })
})
