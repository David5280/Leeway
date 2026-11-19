import { describe, expect, it } from 'vitest'
import { addDays } from '../../lib/dates'
import { lineFrame, timeTickLabel } from './LineChart'
import {
  edgeAnchor,
  paceAxis,
  paceEndLabels,
  paceFrame,
  paceState,
  steadyAt,
  type Pace,
} from './pace'
import { barAxis, barLayout, barPath, barPrecision } from './PeriodBars'

const usd = { currency: 'USD', locale: 'en-US' }

/** November with spending recorded through the 17th: $20 a day. */
function pace(fields: Partial<Pace> = {}): Pace {
  return {
    start: '2026-11-01',
    end: '2026-11-30',
    days: 30,
    categoryIds: [],
    budgetCents: 80_000,
    cumulative: Array.from({ length: 17 }, (_, i) => ({
      date: addDays('2026-11-01', i),
      cents: (i + 1) * 2_000,
    })),
    projectedCents: 60_000,
    ...fields,
  }
}

describe('paceAxis', () => {
  it('stops a wild projection at 1.6 times the budget so the rest stays readable', () => {
    expect(paceAxis(80_000, 34_000, 960_000).values).toEqual([0, 50_000, 100_000, 150_000])
  })

  it('follows the projection when there is no budget or spending to scale by', () => {
    expect(paceAxis(0, 0, 5_000).values).toEqual([0, 2_000, 4_000, 6_000])
    expect(paceAxis(0, 0, 0).high).toBe(10_000)
  })
})

describe('steadyAt', () => {
  it('spreads the budget evenly, reaching all of it on the last day', () => {
    expect(steadyAt(80_000, 0, 30)).toBe(2_667)
    expect(steadyAt(80_000, 29, 30)).toBe(80_000)
    expect(steadyAt(500, 0, 0)).toBe(500)
  })
})

describe('paceState', () => {
  it('projects from the last day with data while the period runs', () => {
    expect(paceState(pace(), true)).toEqual({ lastIndex: 16, spentCents: 34_000, projecting: true })
  })

  it('projects nothing for a finished period, a complete one, or one with no days', () => {
    expect(paceState(pace(), false).projecting).toBe(false)
    const full = pace({
      cumulative: Array.from({ length: 30 }, (_, i) => ({
        date: addDays('2026-11-01', i),
        cents: 1_000,
      })),
    })
    expect(paceState(full, true).projecting).toBe(false)
    expect(paceState(pace({ cumulative: [] }), true)).toEqual({
      lastIndex: -1,
      spentCents: 0,
      projecting: false,
    })
  })
})

describe('paceEndLabels', () => {
  it('names the budget and where spending is heading', () => {
    const current = pace()
    expect(paceEndLabels(current, paceState(current, true))).toEqual([
      { name: 'Budget', cents: 80_000, tone: 'muted' },
      { name: 'Projected', cents: 60_000, tone: 'accent' },
    ])
  })

  it('names where a finished period ended', () => {
    const past = pace()
    expect(paceEndLabels(past, paceState(past, false))).toEqual([
      { name: 'Budget', cents: 80_000, tone: 'muted' },
      { name: 'Spent', cents: 34_000, tone: 'accent' },
    ])
  })

  it('labels nothing with no budget and no days', () => {
    const empty = pace({ budgetCents: 0, cumulative: [] })
    expect(paceEndLabels(empty, paceState(empty, false))).toEqual([])
  })
})

describe('paceFrame', () => {
  it('leaves gutters as wide as the labels, and at least room for "Projected"', () => {
    expect(paceFrame(640, ['$0', '$1,500'], ['$800', '$960'])).toEqual({
      height: 250,
      left: 56,
      right: 568,
      top: 26,
      bottom: 220,
    })
  })

  it('is shorter on a phone and widens the right gutter for long amounts', () => {
    expect(paceFrame(390, [], ['$12,345.67'])).toEqual({
      height: 210,
      left: 12,
      right: 298,
      top: 26,
      bottom: 180,
    })
  })
})

describe('edgeAnchor', () => {
  it('pins the first and last date labels inside the plot', () => {
    expect(edgeAnchor(0, 30)).toBe('start')
    expect(edgeAnchor(29, 30)).toBe('end')
    expect(edgeAnchor(10, 30)).toBe('middle')
  })
})

describe('barPath', () => {
  it('rounds the top corners and sits flat on the baseline', () => {
    expect(barPath(10, 50, 20, 100)).toBe('M10,100 V54 Q10,50 14,50 H26 Q30,50 30,54 V100 Z')
  })

  it('shrinks the rounding for a short bar and draws nothing for an empty one', () => {
    expect(barPath(0, 98, 20, 100)).toBe('M0,100 V100 Q0,98 2,98 H18 Q20,98 20,100 V100 Z')
    expect(barPath(10, 100, 20, 100)).toBe('')
  })
})

describe('barAxis', () => {
  it('reaches past the budget or the tallest bar, whichever is higher', () => {
    expect(barAxis([50_000, 30_000], 80_000).values).toEqual([0, 50_000, 100_000])
    expect(barAxis([120_000], null).values).toEqual([0, 50_000, 100_000, 150_000])
  })
})

describe('barLayout', () => {
  it('shares the plot evenly between the bars, keeping gutters for the labels', () => {
    expect(barLayout(6, 540, ['$0', '$1,000'], '$800')).toEqual({
      height: 230,
      left: 56,
      right: 476,
      top: 22,
      bottom: 202,
      slot: 70,
      barWidth: 43.4,
    })
  })

  it('needs no right gutter without a budget, and caps the bar width', () => {
    expect(barLayout(2, 300, [], '')).toMatchObject({
      height: 200,
      left: 12,
      right: 292,
      slot: 140,
      barWidth: 56,
    })
  })
})

describe('barPrecision', () => {
  it('writes whole amounts when they fit over their bars', () => {
    expect(barPrecision([50_000, 34_000], 70, usd)).toBe('whole')
  })

  it('shortens every amount alike when whole ones crowd, and drops them when even those do', () => {
    expect(barPrecision([123_456, 99_999], 50, usd)).toBe('compact')
    expect(barPrecision([123_456, 99_999], 30, usd)).toBeNull()
  })
})

describe('timeTickLabel', () => {
  it('shows days, months, and the year where it changes', () => {
    expect(timeTickLabel({ date: '2026-03-04', monthly: false, showYear: false }, 'en-US')).toBe(
      'Mar 4',
    )
    expect(timeTickLabel({ date: '2026-03-01', monthly: true, showYear: false }, 'en-US')).toBe(
      'Mar',
    )
    expect(timeTickLabel({ date: '2026-01-01', monthly: true, showYear: true }, 'en-US')).toBe(
      'Jan 2026',
    )
  })
})

describe('lineFrame', () => {
  it('draws the compact line edge to edge', () => {
    expect(lineFrame(true, 300, ['$0'], '$7,000')).toEqual({
      height: 72,
      left: 2,
      right: 294,
      top: 8,
      bottom: 68,
    })
  })

  it('keeps gutters for the value labels and the latest value', () => {
    expect(lineFrame(false, 640, ['$0', '$5K'], '$7,000')).toEqual({
      height: 250,
      left: 34,
      right: 575,
      top: 14,
      bottom: 220,
    })
  })
})
