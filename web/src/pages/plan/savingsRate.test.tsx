// "How much of your pay do you save?" under net worth on Plan.

import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { RATE_MONTHS, SavingsRateCard } from './SavingsRate'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const NOTE =
  'Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.'
const rate = (start: string, percent: number | null, current = false) => ({
  start,
  current,
  percent,
  savedCents: percent === null ? 0 : percent * 4000,
  payCents: 400000,
})

const region = () => screen.getByRole('region', { name: 'Savings rate' })
const fills = () =>
  [...region().querySelectorAll('svg.chart-svg g[aria-hidden] > path')].map((path) =>
    path.getAttribute('fill'),
  )

describe('SavingsRateCard', () => {
  it('answers with a usual month, each month against the usual, and what was counted', async () => {
    const server = fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-09-01', 10), rate('2026-10-01', 14), rate('2026-11-01', 3, true)],
        targetPercent: null,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    await screen.findByText('of pay, in a usual month')
    expect(server.actions('get_savings_rates')).toEqual([{ months: RATE_MONTHS }])
    expect(region()).toHaveTextContent('How much of your pay do you save?')
    expect(region()).toHaveTextContent('12%of pay, in a usual month')
    expect(region()).toHaveTextContent(NOTE)
    expect(region()).not.toHaveTextContent('Pay is an estimate')
    // Without a target of their own, no month is marked as reaching one.
    expect(fills()).toEqual(['var(--tone-muted)', 'var(--tone-muted)', 'var(--tone-muted)'])
    expect(within(region()).getByText('Usual')).toBeInTheDocument()
    expect(within(region()).getByRole('img')).toHaveAccessibleDescription(
      'Sep 2026: 10%. Oct 2026: 14%. Nov 2026: 3%. Usual: 12%.',
    )
  })

  it('says pay is an estimate while the current employer has paid once', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-09-01', 10), rate('2026-10-01', 14), rate('2026-11-01', 3, true)],
        targetPercent: null,
        note: NOTE,
        payEstimated: true,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    await screen.findByText('of pay, in a usual month')
    expect(region()).toHaveTextContent(
      'Pay is an estimate for now: there is one paycheck from your current employer so far.',
    )
  })

  it('marks months that reached the owner’s own target, and reads out each month', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-09-01', 20), rate('2026-10-01', null), rate('2026-11-01', 5, true)],
        targetPercent: 15,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    await screen.findByText('Your target')
    // October has no rate, so no bar: it is not known, not zero.
    expect(fills()).toEqual(['var(--tone-in)', 'var(--tone-muted)'])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 540,
    } as DOMRect)
    const hit = within(region()).getByTestId('chart-hit')
    const readout = () => region().querySelector('.chart-readout')
    fireEvent.pointerMove(hit, { clientX: 60 })
    expect(readout()).toHaveTextContent('Sep 202620% of pay saved$800 of $4,000')
    fireEvent.pointerMove(hit, { clientX: 270 })
    expect(readout()).toHaveTextContent('Not known yet: no pay or saving seen')
    fireEvent.pointerMove(hit, { clientX: 500 })
    expect(readout()).toHaveTextContent('5% of pay saved so far')
  })

  it('waits for a finished month before it answers', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-11-01', null, true)],
        targetPercent: null,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    expect(
      await screen.findByText('A rate shows here once a month with pay and saving ends.'),
    ).toBeInTheDocument()
    expect(within(region()).queryByText('Usual')).not.toBeInTheDocument()
  })

  it('keeps huge amounts and rates on the chart', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [
          { start: '2026-10-01', current: false, percent: 90, savedCents: 9e14, payCents: 1e15 },
        ],
        targetPercent: 90,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    expect(await screen.findByText('90%', { selector: '.mid-number' })).toBeInTheDocument()
  })

  it('stops a month over 100% at the top and writes its real rate over it', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-09-01', 10), rate('2026-10-01', 140), rate('2026-11-01', 12)],
        targetPercent: null,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    // The usual month is the middle one, so the big month does not set it.
    expect(await screen.findByText('12%', { selector: '.mid-number' })).toBeInTheDocument()
    const chart = within(region()).getByRole('img')
    expect(chart).toHaveTextContent('140%')
    // The scale stops at all of pay rather than stretching to fit the one month.
    expect(chart).toHaveTextContent('100%')
    expect(chart).not.toHaveTextContent('150%')
    // The big month's bar stops exactly at the 100% gridline.
    const tick = [...chart.querySelectorAll('text.chart-axis')].find(
      (text) => text.textContent === '100%' && text.getAttribute('text-anchor') === 'end',
    )!
    const gridY = Number(tick.getAttribute('y')) - 4
    const bars = [...chart.querySelectorAll('g[aria-hidden] > path')]
    const barTop = (bar: Element) => Number(/Q[\d.]+,([\d.]+)/.exec(bar.getAttribute('d')!)![1])
    expect(barTop(bars[1]!)).toBeCloseTo(gridY, 6)
    expect(barTop(bars[0]!)).toBeGreaterThan(gridY)
  })

  it('opens the math from its question, while the bars keep their readout', async () => {
    fakeServer({
      get_savings_rates: () => ({
        months: [rate('2026-09-01', 10), rate('2026-10-01', 14), rate('2026-11-01', 3, true)],
        targetPercent: null,
        note: NOTE,
        payEstimated: false,
      }),
    })
    renderSignedIn(<SavingsRateCard />)
    await screen.findByText('of pay, in a usual month')
    const button = within(region()).getByRole('button')
    // The chart is outside the button, so a finger on it reads the chart.
    expect(button).not.toContainElement(within(region()).getByRole('img'))
    await userEvent.click(button)
    const sheet = screen.getByRole('dialog', { name: 'Savings rate' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Usual month, halfway between the two 12% = Sep 2026, the middle 10% and Oct 2026, the middle 14%',
    )
  })

  it('says why the rates could not be read', async () => {
    fakeServer({}, { '/api/actions/get_savings_rates': failing('Database is down') })
    renderSignedIn(<SavingsRateCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})
