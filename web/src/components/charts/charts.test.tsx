import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays } from '../../lib/dates'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { LineChart } from './LineChart'
import type { Pace } from './pace'
import { PaceChart } from './PaceChart'
import { PeriodBars } from './PeriodBars'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A ResizeObserver that reports a phone-width card as soon as it starts watching. */
class PhoneObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    const entry = { contentRect: { width: 358 } } as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }
  disconnect() {}
}

function svgHeights() {
  return [...document.querySelectorAll('svg.chart-svg')].map((svg) => svg.getAttribute('height'))
}

describe('on a phone', () => {
  it('draws every chart at the card width and a little shorter', () => {
    vi.stubGlobal('ResizeObserver', PhoneObserver)
    fakeServer({})
    renderSignedIn(
      <>
        <PeriodBars bars={bars} budgetCents={80_000} color="teal" label="Groceries" />
        <PaceChart pace={pace()} isCurrent />
        <LineChart points={history} label="Net worth" description="Rising." />
      </>,
    )
    expect(svgHeights()).toEqual(['200', '210', '210'])
    expect(document.querySelector('svg.chart-svg')).toHaveAttribute('viewBox', '0 0 358 200')
  })
})

describe('the pointer', () => {
  it('finds the right point when CSS has stretched the drawing', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} color="teal" label="Groceries" />)
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
    renderSignedIn(<PeriodBars bars={bars} budgetCents={80_000} color="teal" label="Groceries" />)
    expect(screen.getByRole('img', { name: 'Groceries' })).toHaveAccessibleDescription(
      'Sep $500, Oct $620, Nov $340. Budget $800.',
    )
  })

  it('reads out the bar under the pointer, marking the running period as so far', () => {
    fakeServer({})
    renderSignedIn(<PeriodBars bars={bars} budgetCents={null} color="teal" label="Groceries" />)
    point('last')
    expect(readout()).toHaveTextContent('Nov$340 so far')
    point('first')
    expect(readout()).toHaveTextContent('Sep$500')
    fireEvent.pointerLeave(screen.getByTestId('chart-hit'))
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
        color="teal"
        label="Groceries"
      />,
    )
    expect(screen.getByRole('img')).toHaveTextContent('Nothing in these periods yet')
    expect(screen.getByRole('img')).not.toHaveTextContent('Budget')
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
  it('labels months along the bottom and the latest value at the end', () => {
    fakeServer({})
    renderSignedIn(<LineChart points={history} label="Net worth" description="Rising." />)
    const chart = screen.getByRole('img', { name: 'Net worth' })
    expect(chart).toHaveAccessibleDescription('Rising.')
    expect(chart).toHaveTextContent('Jul 2026')
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
