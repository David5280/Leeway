// Money in beside money out for each month, against the usual month's spending.

import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlowMonth } from '../../lib/flows'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { describeFlows, FlowBars, monthLabel, pairWidths } from './FlowBars'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flow = (
  start: string,
  incomeCents: number,
  spentCents: number,
  current = false,
): FlowMonth => ({
  start,
  incomeCents,
  spentCents,
  keptCents: incomeCents - spentCents,
  current,
})

const months = [
  flow('2026-09-01', 300000, 120000),
  flow('2026-10-01', 300000, 340000),
  flow('2026-11-01', 0, 90000, true),
]

const fills = () =>
  [...document.querySelectorAll('svg.chart-svg g[aria-hidden] path')].map((path) =>
    path.getAttribute('fill'),
  )

const readout = () => document.querySelector('.chart-readout')

describe('FlowBars', () => {
  it('pairs green money in with darker plain money out, red only for a finished month that ran short', () => {
    fakeServer({})
    renderSignedIn(<FlowBars months={months} usualSpentCents={230000} label="In and out" />)
    expect(fills()).toEqual([
      'var(--tone-in)',
      'var(--tone-out)',
      'var(--tone-in)',
      'var(--tone-problem)',
      'var(--tone-in)',
      // November is still running, so it is not judged yet.
      'var(--tone-out)',
    ])
    expect(screen.getByRole('img', { name: 'In and out' })).toBeInTheDocument()
    expect(document.querySelector('.chart-line.budget')).not.toBeNull()
    expect(screen.getByText('Usual out')).toBeInTheDocument()
    expect(screen.getByText('Sep')).toBeInTheDocument()
    expect(screen.getByText('Nov')).toHaveClass('strong-label')
  })

  it('reads out a tapped month in words', () => {
    fakeServer({})
    renderSignedIn(<FlowBars months={months} usualSpentCents={null} label="In and out" />)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 540,
    } as DOMRect)
    const hit = screen.getByTestId('chart-hit')
    fireEvent.pointerMove(hit, { clientX: 300 })
    expect(readout()).toHaveTextContent('Oct 2026$3,000 in$3,400 outShort $400')
    fireEvent.pointerMove(hit, { clientX: 530 })
    expect(readout()).toHaveTextContent('$900 out so farShort $900')
    fireEvent.pointerMove(hit, { clientX: 60 })
    expect(readout()).toHaveTextContent('Kept $1,800')
    // With no usual month there is no dashed level.
    expect(document.querySelector('.chart-line.budget')).toBeNull()
  })

  it('says so when nothing has come in or gone out, and draws refunds as empty bars', () => {
    fakeServer({})
    renderSignedIn(
      <FlowBars
        months={[flow('2026-10-01', 0, 0), flow('2026-11-01', -500, -2000, true)]}
        usualSpentCents={0}
        label="In and out"
      />,
    )
    expect(screen.getByText('Nothing in or out yet')).toBeInTheDocument()
    expect(document.querySelector('.chart-line.budget')).toBeNull()
    // No scale on an empty install: a $0 to $100 axis would measure nothing.
    expect(screen.getByRole('img')).not.toHaveTextContent('$0')
    expect(document.querySelector('.chart-grid')).toBeNull()
    expect(document.querySelectorAll('.chart-baseline')).toHaveLength(1)
  })

  it('keeps huge amounts on the axis', () => {
    fakeServer({})
    renderSignedIn(
      <FlowBars months={[flow('2026-10-01', 9e14, 8e14)]} usualSpentCents={8e14} label="Big" />,
    )
    expect(screen.getByRole('img', { name: 'Big' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing in or out yet')).not.toBeInTheDocument()
  })
})

describe('FlowBars parts', () => {
  it('names a month by its short name', () => {
    expect(monthLabel('2026-10-01', 'en-US')).toBe('Oct')
  })

  it('keeps each pair of bars inside its slot, never thinner than a few pixels', () => {
    expect(pairWidths(80)).toEqual({ bar: 22, gap: 4 })
    const narrow = pairWidths(20)
    expect(narrow.bar * 2 + narrow.gap).toBeLessThanOrEqual(20)
    expect(pairWidths(4).bar).toBe(3)
  })

  it('describes each month, and the usual one when there is one', () => {
    const money = (cents: number) => `$${cents / 100}`
    expect(describeFlows(months.slice(0, 1), null, money, 'en-US')).toBe(
      'Sep 2026: $3000 in, $1200 out.',
    )
    expect(describeFlows(months.slice(0, 1), 50000, money, 'en-US')).toBe(
      "Sep 2026: $3000 in, $1200 out. A usual month's spending is $500.",
    )
  })
})
