import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { textWidth } from '../../lib/chartScale'
import { addDays } from '../../lib/dates'
import { money as format } from '../../lib/money'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { range } from '../../../../server/src/domain/profile/rangeWords'
import { ageTicks, BandChart, bandPath, type BandPoint } from './BandChart'
import { LineChart } from './LineChart'
import { boxCorners, shapesMeet, turnedCorners, type Pace } from './pace'
import { PaceChart } from './PaceChart'
import { AXIS_FONT } from './parts'
import { barTone, labelledBars, PeriodBars } from './PeriodBars'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A ResizeObserver that reports a phone-width card as soon as it starts watching. */
/** A ResizeObserver that reports a chart `width` wide, as on a phone. */
function observerOf(width: number) {
  return class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      const entry = { contentRect: { width } } as ResizeObserverEntry
      this.callback([entry], this as unknown as ResizeObserver)
    }
    disconnect() {}
  }
}

const PhoneObserver = observerOf(358)

function svgHeights() {
  return [...document.querySelectorAll('svg.chart-svg')].map((svg) => svg.getAttribute('height'))
}

describe('on a phone', () => {
  it('draws every chart at the card width and a little shorter', () => {
    vi.stubGlobal('ResizeObserver', PhoneObserver)
    fakeServer({})
    renderSignedIn(
      <>
        <PeriodBars bars={bars} budgetCents={80_000} label="Groceries" />
        <PaceChart pace={pace()} isCurrent />
        <LineChart points={history} label="Net worth" description="Rising." />
        <BandChart points={band} label="Savings by age" description="Growing." />
      </>,
    )
    expect(svgHeights()).toEqual(['200', '210', '210', '200'])
    expect(document.querySelector('svg.chart-svg')).toHaveAttribute('viewBox', '0 0 358 200')
  })
})

describe('the pointer', () => {
  it('finds the right point when CSS has stretched the drawing', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} label="Groceries" />)
    // Drawn 540 wide but shown 1080 wide, from x = 100: every screen pixel is half a drawn one.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 1_080,
    } as DOMRect)
    fireEvent.pointerMove(screen.getByTestId('chart-hit'), { clientX: 100 + 2 * 470 })
    expect(readout()).toHaveTextContent('Nov')
    fireEvent.pointerMove(screen.getByTestId('chart-hit'), { clientX: 100 + 2 * 60 })
    expect(readout()).toHaveTextContent('Sep')
  })
})

/** Moves the pointer far to the left or right of the plot, landing on its first or last point. */
function point(at: 'first' | 'last') {
  fireEvent.pointerMove(screen.getByTestId('chart-hit'), { clientX: at === 'first' ? 0 : 5_000 })
}

function readout() {
  return document.querySelector('.chart-readout')
}

const bars = [
  { label: 'Sep', cents: 50_000, current: false },
  { label: 'Oct', cents: 62_000, current: false },
  { label: 'Nov', cents: 34_000, current: true },
]

describe('PeriodBars', () => {
  it('is one image with a name and a description of every bar', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={80_000} label="Groceries" />)
    expect(screen.getByRole('img', { name: 'Groceries' })).toHaveAccessibleDescription(
      'Sep $500, Oct $620, Nov $340. Budget $800.',
    )
  })

  it('names the level the usual period when there is no budget', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={56_000} levelName="Usual" label="Coffee" />)
    expect(screen.getByText('Usual')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Coffee' })).toHaveAccessibleDescription(
      'Sep $500, Oct $620, Nov $340. Usual $560.',
    )
  })

  it('reads out the bar under the pointer, marking the running period as so far', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} label="Groceries" />)
    point('last')
    expect(readout()).toHaveTextContent('Nov$340 so far')
    point('first')
    expect(readout()).toHaveTextContent('Sep$500')
    // A finger lifting fires leave at once on a phone, so the readout stays to be read.
    fireEvent.pointerLeave(screen.getByTestId('chart-hit'), { pointerType: 'touch' })
    expect(readout()).toHaveTextContent('Sep$500')
    fireEvent.pointerLeave(screen.getByTestId('chart-hit'))
    expect(readout()).toBeNull()
  })

  it('clears a finger readout when the touch turns into a scroll', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} label="Groceries" />)
    point('last')
    expect(readout()).not.toBeNull()
    // The browser cancels the pointer once it takes the touch over for scrolling.
    fireEvent.pointerCancel(screen.getByTestId('chart-hit'), { pointerType: 'touch' })
    expect(readout()).toBeNull()
  })

  it('clears the readout on a press anywhere off the plot, and keeps it on the plot', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} label="Groceries" />)
    point('first')
    fireEvent.pointerDown(screen.getByTestId('chart-hit'), { clientX: 0 })
    expect(readout()).toHaveTextContent('Sep$500')
    fireEvent.pointerDown(document.body)
    expect(readout()).toBeNull()
    // With no readout up, a press elsewhere changes nothing.
    fireEvent.pointerDown(document.body)
    expect(readout()).toBeNull()
  })

  it('says so when nothing was spent, and draws refunds as empty bars', () => {
    fakeServer({})
    renderSignedIn(
      <PeriodBars
        bars={[
          { label: 'Oct', cents: 0, current: false },
          { label: 'Nov', cents: -1_500, current: true },
        ]}
        budgetCents={0}
        label="Groceries"
      />,
    )
    expect(screen.getByRole('img')).toHaveTextContent('Nothing in these periods yet')
    expect(screen.getByRole('img')).not.toHaveTextContent('Budget')
  })

  it('leaves the scale off an empty chart, so its note has the middle to itself', () => {
    fakeServer({})
    renderSignedIn(
      <PeriodBars
        bars={[
          { label: 'Oct', cents: 0, current: false },
          { label: 'Nov', cents: 0, current: true },
        ]}
        budgetCents={200_000}
        label="Groceries"
      />,
    )
    expect(screen.getByRole('img')).toHaveTextContent('Nothing in these periods yet')
    expect(screen.getByRole('img')).not.toHaveTextContent('$1,000')
  })
})

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
    projectedCents: 96_000,
    ...fields,
  }
}

describe('PaceChart', () => {
  it('describes the current period, with today and the projection labeled', () => {
    fakeServer({})
    renderSignedIn(<PaceChart pace={pace()} isCurrent />)
    const chart = screen.getByRole('img', { name: 'Flexible spending pace' })
    expect(chart).toHaveAccessibleDescription(
      '$340 spent by Nov 17 against a $800 budget for Nov 1 to Nov 30, on track for $960.',
    )
    expect(chart).toHaveTextContent('Today')
    expect(chart).toHaveTextContent('Projected$960')
    expect(chart).toHaveTextContent('Steady pace')
  })

  it('labels where a finished period ended, without today or a projection', () => {
    fakeServer({})
    renderSignedIn(<PaceChart pace={pace()} isCurrent={false} />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleDescription(
      '$340 spent by Nov 17 against a $800 budget for Nov 1 to Nov 30.',
    )
    expect(chart).toHaveTextContent('Spent$340')
    expect(chart).not.toHaveTextContent('Today')
    expect(chart).not.toHaveTextContent('Projected')
  })

  it('reads out spending and the steady pace on the day under the pointer', () => {
    fakeServer({})
    renderSignedIn(<PaceChart pace={pace()} isCurrent />)
    point('last')
    expect(readout()).toHaveTextContent('Nov 17$340 spentSteady pace $453')
  })

  it('labels the steady pace above its line when the budget is too small to leave room below', () => {
    fakeServer({})
    /** How far the label sits below the point on the slope it turns about. */
    const offset = (budgetCents: number) => {
      const { container, unmount } = renderSignedIn(
        <PaceChart pace={pace({ budgetCents })} isCurrent />,
      )
      const label = Array.from(container.querySelectorAll('text')).find(
        (text) => text.textContent === 'Steady pace',
      )!
      const turn = /rotate\(\S+ \S+ (\S+)\)/.exec(label.getAttribute('transform')!)!
      const below = Number(label.getAttribute('y')) - Number(turn[1])
      unmount()
      return below
    }
    // Heading past the budget, the label sits under the slope, clear of the projection.
    expect(offset(80_000)).toBeGreaterThan(0)
    expect(offset(1_000)).toBeLessThan(0)
  })

  describe("the steady pace label, beside today's amount", () => {
    /** Spending on the steady pace, a little under it, through day `days` of November. */
    const onPace = (days: number) =>
      pace({
        cumulative: Array.from({ length: days }, (_, i) => ({
          date: addDays('2026-11-01', i),
          cents: Math.round((72_000 * (i + 1)) / 30),
        })),
        projectedCents: 72_000,
      })
    /** Where the label is centred and where today's dot is. */
    const spots = (chart: Pace, isCurrent = true) => {
      const { container, unmount } = renderSignedIn(
        <PaceChart pace={chart} isCurrent={isCurrent} />,
      )
      const label = [...container.querySelectorAll('text')].find(
        (text) => text.textContent === 'Steady pace',
      )!
      const dot = container.querySelector('circle.chart-dot')
      const spot = {
        label: Number(label.getAttribute('x')),
        today: Number(dot?.getAttribute('cx')),
      }
      unmount()
      return spot
    }

    it("stays two thirds along when today's amount is clear of it", () => {
      fakeServer({})
      // Through the 17th at $20 a day, spending is well under the steady pace.
      expect(spots(pace()).label).toBe(spots(pace(), false).label)
      vi.stubGlobal('ResizeObserver', PhoneObserver)
      expect(spots(pace()).label).toBe(spots(pace(), false).label)
    })

    it('slides up the slope past today when spending runs close to it', () => {
      vi.stubGlobal('ResizeObserver', observerOf(400))
      fakeServer({})
      // Day 17 of 30 on a wider phone: today's amount sits where the label would.
      const { label, today } = spots(onPace(17))
      expect(label).toBeGreaterThan(today)
      expect(label).not.toBe(spots(onPace(17), false).label)
    })

    it('goes back before today when the room past it is too short', () => {
      vi.stubGlobal('ResizeObserver', PhoneObserver)
      fakeServer({})
      // Day 17 of 30 on a phone leaves too little slope after today for the whole turned label.
      const { label, today } = spots(onPace(17))
      expect(label).toBeLessThan(today)
    })

    it('keeps a moved label off the amount and inside the plot on the narrowest phones', () => {
      fakeServer({})
      const placed: string[] = []
      // Every width from 300px to 320px, each day of a fortnight, at a few paces near steady.
      const cases = [300, 305, 310, 315, 320].flatMap((width) =>
        Array.from({ length: 14 }, (_, i) =>
          [0.8, 0.9, 1, 1.1].map((rate) => ({ width, day: i + 1, rate })),
        ).flat(),
      )
      for (const { width, day, rate } of cases) {
        vi.stubGlobal('ResizeObserver', observerOf(width))
        const { container, unmount } = renderSignedIn(
          <PaceChart pace={fortnight(day, rate)} isCurrent />,
        )
        const clash = movedLabelClash(container)
        if (clash) placed.push(`${width}px, day ${day}, ${rate} of pace: ${clash}`)
        unmount()
      }
      expect(placed).toEqual([])
    })

    it('draws a moved label over the spending line, ringed so it stays legible', () => {
      vi.stubGlobal('ResizeObserver', PhoneObserver)
      fakeServer({})
      const steadyText = (container: HTMLElement) =>
        [...container.querySelectorAll('text')].find((text) => text.textContent === 'Steady pace')!
      const moved = renderSignedIn(<PaceChart pace={onPace(17)} isCurrent />)
      const label = steadyText(moved.container)
      const line = moved.container.querySelector('path.chart-line.actual')!
      expect(label).toHaveClass('halo')
      expect(line.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      moved.unmount()
      // In its usual place it sits under the line, as before.
      const usual = renderSignedIn(<PaceChart pace={pace()} isCurrent />)
      expect(steadyText(usual.container)).not.toHaveClass('halo')
    })
  })

  it('still draws a period with no spending and no budget', () => {
    fakeServer({})
    renderSignedIn(<PaceChart pace={pace({ cumulative: [], budgetCents: 0 })} isCurrent />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleDescription(
      '$0 spent by Nov 1 against a $0 budget for Nov 1 to Nov 30.',
    )
    expect(chart).not.toHaveTextContent('Steady pace')
  })
})

const history = [
  { date: '2026-06-01', cents: -50_000 },
  { date: '2026-08-15', cents: 250_000 },
  { date: '2026-11-17', cents: 700_000 },
]

describe('LineChart', () => {
  it('labels the first and last months along the bottom and the latest value at the end', () => {
    fakeServer({})
    renderSignedIn(<LineChart points={history} label="Net worth" description="Rising." />)
    const chart = screen.getByRole('img', { name: 'Net worth' })
    expect(chart).toHaveAccessibleDescription('Rising.')
    expect(chart).toHaveTextContent('Jun 2026')
    expect(chart).toHaveTextContent('Nov 2026')
    expect(chart).toHaveTextContent('$7,000')
  })

  it('reads out the point under the pointer', () => {
    fakeServer({})
    renderSignedIn(<LineChart points={history} label="Net worth" description="Rising." />)
    point('first')
    expect(readout()).toHaveTextContent('Jun 1\u2212$500')
    fireEvent.pointerLeave(screen.getByTestId('chart-hit'))
    expect(readout()).toBeNull()
  })

  it('draws a compact line with no axes, labels or pointer', () => {
    fakeServer({})
    renderSignedIn(<LineChart points={history} label="Net worth" description="Rising." compact />)
    const chart = screen.getByRole('img', { name: 'Net worth' })
    expect(chart).not.toHaveTextContent('$')
    expect(screen.queryByTestId('chart-hit')).toBeNull()
  })

  it('draws a single point without a line', () => {
    fakeServer({})
    renderSignedIn(
      <LineChart
        points={[{ date: '2026-11-17', cents: 1_000 }]}
        label="Net worth"
        description="One day."
      />,
    )
    expect(screen.getByRole('img')).toHaveTextContent('$10')
    expect(document.querySelector('.chart-line')).toBeNull()
  })
})

/** Savings from 40 to 65 in three steps, spreading as the years go. */
const band: BandPoint[] = [
  { age: 40, low: 4_000_000, mid: 4_000_000, high: 4_000_000 },
  { age: 50, low: 4_600_000, mid: 5_600_000, high: 6_700_000 },
  { age: 65, low: 5_750_000, mid: 9_260_000, high: 14_780_000 },
]

const money = (cents: number) => format(cents, { currency: 'USD', locale: 'en-US' })

describe('ageTicks', () => {
  it('labels the first and last age with even whole steps between', () => {
    expect(ageTicks(40, 65, 6)).toEqual([40, 45, 50, 55, 60, 65])
    expect(ageTicks(40, 45, 10)).toEqual([40, 41, 42, 43, 44, 45])
  })

  it('drops the label before the last when the two would crowd', () => {
    expect(ageTicks(40, 65, 5)).toEqual([40, 47, 54, 61, 65])
    // Steps of 7 would put 68 three years from 71, so 68 goes.
    expect(ageTicks(40, 71, 6)).toEqual([40, 47, 54, 61, 71])
  })

  it('labels a single age once, even with room for none', () => {
    expect(ageTicks(65, 65, 6)).toEqual([65])
    expect(ageTicks(40, 42, 0)).toEqual([40, 42])
  })
})

describe('range, as the chart words its readout', () => {
  it('gives a range, or one figure when the cases agree', () => {
    expect(range({ low: 5_750_000, mid: 9_000_000, high: 14_780_000 }, money)).toBe(
      '$57,500 to $147,800',
    )
    expect(range({ low: 4_000_000, mid: 4_000_000, high: 4_000_000 }, money)).toBe('$40,000')
  })
})

describe('bandPath', () => {
  it('runs along the high case and back along the low', () => {
    expect(bandPath([0, 10, 20], [5, 4, 3], [6, 7, 8])).toBe('M0,5 L10,4 L20,3 L20,8 L10,7 L0,6 Z')
  })
})

describe('BandChart', () => {
  it('is one image named and described, with ages along the bottom', () => {
    fakeServer({})
    renderSignedIn(<BandChart points={band} label="Savings by age" description="Growing." />)
    const chart = screen.getByRole('img', { name: 'Savings by age' })
    expect(chart).toHaveAccessibleDescription('Growing.')
    expect(chart).toHaveTextContent('40')
    expect(chart).toHaveTextContent('65')
    expect(document.querySelector('.chart-band')).toHaveAttribute('d', expect.stringMatching(/Z$/))
  })

  it('reads out the range and the middle case at the age under the pointer', () => {
    fakeServer({})
    renderSignedIn(<BandChart points={band} label="Savings by age" description="Growing." />)
    point('last')
    expect(readout()).toHaveTextContent('At 65$57,500 to $147,800Middle $92,600')
    // Today's savings are known, so the cases agree and the readout gives one figure.
    point('first')
    expect(readout()).toHaveTextContent(/^At 40\$40,000$/)
    fireEvent.pointerLeave(screen.getByTestId('chart-hit'))
    expect(readout()).toBeNull()
  })

  it('gives every year to a screen reader as a table, with no pointer needed', () => {
    fakeServer({})
    renderSignedIn(<BandChart points={band} label="Savings by age" description="Growing." />)
    const table = screen.getByRole('table', { name: 'Savings by age, each year' })
    expect(table).toHaveClass('visually-hidden')
    const rows = screen.getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual([
      'AgeRangeMiddle case',
      '40$40,000$40,000',
      '50$46,000 to $67,000$56,000',
      '65$57,500 to $147,800$92,600',
    ])
  })

  it('draws a single age without failing', () => {
    fakeServer({})
    renderSignedIn(
      <BandChart points={band.slice(0, 1)} label="Savings by age" description="Now." />,
    )
    expect(screen.getByRole('img', { name: 'Savings by age' })).toHaveTextContent('40')
  })
})

describe('PeriodBars colors and labels', () => {
  it('is plain under budget, red only over it, and green for money in', () => {
    expect(barTone(50_000, 60_000, false, true)).toBe('var(--tone-muted)')
    expect(barTone(70_000, 60_000, false, true)).toBe('var(--tone-problem)')
    // Over the usual period, with no budget to go over, is not a problem.
    expect(barTone(70_000, 60_000, false, false)).toBe('var(--tone-muted)')
    expect(barTone(70_000, null, false, true)).toBe('var(--tone-muted)')
    expect(barTone(70_000, 60_000, true, true)).toBe('var(--tone-in)')
  })

  it('labels every bar that fits, else every n-th back from the newest', () => {
    expect([...labelledBars(6, 60, 40)].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect([...labelledBars(6, 34, 47)].sort()).toEqual([1, 3, 5])
    expect([...labelledBars(6, 0, 47)].sort()).toEqual([5])
  })

  it('keeps a stub for an empty period, and draws the bar over budget red', () => {
    fakeServer({})
    renderSignedIn(
      <PeriodBars
        bars={[
          { label: 'Oct', cents: 0, current: false },
          { label: 'Nov', cents: 90_000, current: false },
        ]}
        budgetCents={80_000}
        label="Dining"
        overIsProblem
      />,
    )
    const fills = [...document.querySelectorAll('svg.chart-svg path[fill]')].map((path) =>
      path.getAttribute('fill'),
    )
    expect(fills).toEqual(['var(--tone-muted)', 'var(--tone-problem)'])
    expect(document.querySelector('svg.chart-svg path')!.getAttribute('d')).not.toBe('')
    expect(screen.getByRole('img', { name: 'Dining' })).toHaveAccessibleDescription(
      'Oct $0, Nov $900 (over budget). Budget $800.',
    )
  })
})

/** Two weeks of spending at `rate` times the steady pace, through day `day`. */
function fortnight(day: number, rate: number): Pace {
  const budgetCents = 80_000
  const cumulative = Array.from({ length: day }, (_, i) => ({
    date: addDays('2026-11-01', i),
    cents: Math.round((budgetCents / 14) * rate * (i + 1)),
  }))
  return {
    start: '2026-11-01',
    end: '2026-11-14',
    days: 14,
    categoryIds: [],
    budgetCents,
    cumulative,
    projectedCents: Math.round(budgetCents * rate),
  }
}

/**
 * What is wrong with a moved steady pace label in a drawn chart, if anything:
 * its turned shape on today's amount, or reaching past the plot's left edge.
 */
function movedLabelClash(container: HTMLElement): string | null {
  const label = container.querySelector('text.chart-axis.halo')
  if (!label) return null
  const [, angle, x, y] = /rotate\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/
    .exec(label.getAttribute('transform')!)!
    .map(Number)
  const corners = turnedCorners(
    { x: x!, y: y! },
    textWidth('Steady pace', AXIS_FONT),
    AXIS_FONT,
    angle!,
    Number(label.getAttribute('y')) - y!,
  )
  // Today's amount is drawn anchored at its right end, 13px type.
  const amount = container.querySelector('text.chart-value.halo')!
  const right = Number(amount.getAttribute('x'))
  const baseline = Number(amount.getAttribute('y'))
  const box = {
    left: right - textWidth(amount.textContent!, 13),
    right,
    top: baseline - 13,
    bottom: baseline + 4,
  }
  if (shapesMeet(corners, boxCorners(box))) return 'on the amount'
  const left = Number(container.querySelector('clipPath rect')!.getAttribute('x'))
  if (Math.min(...corners.map((corner) => corner.x)) < left - 0.01) return 'past the left edge'
  return null
}
