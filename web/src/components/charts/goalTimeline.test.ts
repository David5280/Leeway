import { describe, expect, it } from 'vitest'
import { anchorFor, timelineLayout } from './goalTimeline'

const labels = { target: 'Goal Apr 30, 2027', projected: 'At this pace Apr 1, 2027' }

describe('anchorFor', () => {
  it('centers a label unless it would cross an edge', () => {
    expect(anchorFor(200, 80, 400)).toBe('middle')
    expect(anchorFor(20, 80, 400)).toBe('start')
    expect(anchorFor(380, 80, 400)).toBe('end')
  })
})

describe('timelineLayout', () => {
  it('runs from today to the later of the date and the projection, with room after', () => {
    const layout = timelineLayout(
      { today: '2026-11-17', targetDate: '2027-04-30', projectedDate: '2027-04-01' },
      labels,
      400,
    )!
    expect(layout.today).toEqual({ x: 6, label: 'Today', anchor: 'start' })
    // The date is the furthest mark, so it sits just short of the right edge.
    expect(layout.target!.x).toBeCloseTo(6 + 388 / 1.06, 5)
    expect(layout.target!.anchor).toBe('end')
    expect(layout.projected!.x).toBeLessThan(layout.target!.x)
    expect(layout.projected!.anchor).toBe('middle')
  })

  it('puts a late projection past the flag', () => {
    const layout = timelineLayout(
      { today: '2026-11-17', targetDate: '2027-04-30', projectedDate: '2029-05-05' },
      labels,
      400,
    )!
    expect(layout.projected!.x).toBeGreaterThan(layout.target!.x)
    expect(layout.projected!.anchor).toBe('end')
  })

  it('drops "Today" when the flag label would run into it', () => {
    const layout = timelineLayout(
      { today: '2026-11-17', targetDate: '2026-11-20', projectedDate: '2027-11-17' },
      labels,
      400,
    )!
    expect(layout.today).toBeNull()
    expect(layout.target!.anchor).toBe('start')
  })

  it('draws whichever mark is ahead, and nothing when none is', () => {
    const onlyDate = timelineLayout(
      { today: '2026-11-17', targetDate: '2027-04-30', projectedDate: null },
      labels,
      400,
    )!
    expect(onlyDate.projected).toBeNull()
    const pastDate = timelineLayout(
      { today: '2026-11-17', targetDate: '2026-10-01', projectedDate: '2027-04-01' },
      labels,
      400,
    )!
    expect(pastDate.target).toBeNull()
    expect(pastDate.projected).not.toBeNull()
    expect(
      timelineLayout({ today: '2026-11-17', targetDate: null, projectedDate: null }, labels, 400),
    ).toBeNull()
    expect(
      timelineLayout(
        { today: '2026-11-17', targetDate: '2026-11-01', projectedDate: null },
        labels,
        400,
      ),
    ).toBeNull()
  })
})
