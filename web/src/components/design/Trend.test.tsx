import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KeyFigure } from './KeyFigure'
import { ProgressRing } from './ProgressRing'
import { SkeletonRows } from './Skeleton'
import { sparkPoints, Sparkline } from './Sparkline'
import { Trend, trendPercent } from './Trend'
import { fakeServer, renderSignedIn } from '../../test/fake'

describe('Trend', () => {
  it('works out the change as a whole percent of the earlier value', () => {
    expect(trendPercent(112, 100)).toBe(12)
    expect(trendPercent(-50, -100)).toBe(50)
    expect(trendPercent(5, 0)).toBeNull()
  })

  it('marks spending going up as bad and down as good, with an arrow either way', () => {
    render(
      <>
        <Trend current={112} previous={100} goodWhen="down" label="Spending" />
        <Trend current={80} previous={100} goodWhen="down" label="Dining" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Spending: up 12%' })).toHaveClass('trend-bad')
    expect(screen.getByRole('img', { name: 'Spending: up 12%' })).toHaveTextContent('▲ 12%')
    expect(screen.getByRole('img', { name: 'Dining: down 20%' })).toHaveClass('trend-good')
  })

  it('says no change plainly, and shows nothing with nothing to compare', () => {
    const { container } = render(
      <>
        <Trend current={100} previous={100} goodWhen="up" label="Savings" />
        <Trend current={100} previous={0} goodWhen="up" label="New" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Savings: no change' })).toHaveClass('trend-flat')
    expect(container.querySelectorAll('.trend')).toHaveLength(1)
  })
})

describe('Sparkline', () => {
  it('draws the lowest value at the bottom and the highest at the top', () => {
    expect(sparkPoints([0, 10])).toBe('0,22 80,2')
    // A flat line sits on the bottom rather than dividing by zero.
    expect(sparkPoints([5, 5, 5])).toBe('0,22 40,22 80,22')
    expect(sparkPoints([1])).toBe('')
  })

  it('is decoration unless given a label, and draws nothing for one point', () => {
    const { container } = render(
      <>
        <Sparkline values={[1, 3, 2]} />
        <Sparkline values={[1, 3, 2]} label="Spending over six months" />
        <Sparkline values={[1]} />
      </>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('img', { name: 'Spending over six months' })).toBeInTheDocument()
  })
})

describe('KeyFigure', () => {
  it('shows a label, the big number, and what it means', () => {
    fakeServer({})
    renderSignedIn(
      <KeyFigure
        label="Left to spend"
        cents={3600}
        caption={
          <>
            <b>$36</b> for the next 4 days
          </>
        }
      />,
    )
    expect(screen.getByText('Left to spend')).toHaveClass('key-figure-label')
    expect(screen.getByText('$36', { selector: '.money' })).toHaveClass('money-xl')
    expect(screen.getByText('for the next 4 days', { exact: false })).toHaveClass(
      'key-figure-caption',
    )
  })

  it('leaves the caption out when there is none', () => {
    fakeServer({})
    const { container } = renderSignedIn(<KeyFigure label="Spent" cents={100} />)
    expect(container.querySelector('.key-figure-caption')).toBeNull()
  })
})

describe('ProgressRing', () => {
  it('fills to the percent, with the number in the middle and the tone of its status', () => {
    render(<ProgressRing percent={40.4} label="Groceries budget used" status="watch" />)
    const ring = screen.getByRole('progressbar', { name: 'Groceries budget used' })
    expect(ring).toHaveAttribute('aria-valuenow', '40')
    expect(ring).toHaveTextContent('40%')
    expect(ring).toHaveClass('ring-watch')
  })

  it('stays full past 100 while the number says how far over, and never runs below empty', () => {
    render(
      <>
        <ProgressRing percent={135} label="Over" />
        <ProgressRing percent={-5} label="Refunded" />
      </>,
    )
    const over = screen.getByRole('progressbar', { name: 'Over' })
    expect(over).toHaveAttribute('aria-valuenow', '100')
    expect(over).toHaveAttribute('aria-valuetext', '135%')
    expect(over.querySelector('.ring-fill')).toHaveAttribute('stroke-dashoffset', '0')
    expect(screen.getByRole('progressbar', { name: 'Refunded' })).toHaveTextContent('0%')
  })

  it("puts today's tick across the rim, a quarter of the way round at 25", () => {
    const { container } = render(
      <>
        <ProgressRing percent={10} label="With a tick" marker={25} />
        <ProgressRing percent={10} label="Without" />
      </>,
    )
    const ticks = container.querySelectorAll('.ring-tick')
    expect(ticks).toHaveLength(1)
    // The svg is turned a quarter back, so a quarter round is straight down in its own frame.
    expect(Number(ticks[0]!.getAttribute('x1'))).toBeCloseTo(20)
    expect(Number(ticks[0]!.getAttribute('y1'))).toBeCloseTo(34)
    expect(Number(ticks[0]!.getAttribute('y2'))).toBeCloseTo(40)
  })
})

describe('SkeletonRows', () => {
  it('stands in for rows while loading, named for screen readers', () => {
    const { container } = render(<SkeletonRows count={3} label="Loading transactions" />)
    expect(screen.getByRole('status', { name: 'Loading transactions' })).toBeInTheDocument()
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(3)
  })

  it('shows six rows by default', () => {
    const { container } = render(<SkeletonRows />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(6)
  })
})
