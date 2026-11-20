// "Are you spending less than you earn?" on the Overview.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { month, totalsOf } from '../test/months'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { FLOW_MONTHS, FlowsWidget } from './Flows'

afterEach(() => vi.unstubAllGlobals())

const region = () => screen.getByRole('region', { name: 'Money in and out' })

describe('FlowsWidget', () => {
  it('answers with what a usual month keeps, over six months of bars, and opens each month', async () => {
    const server = fakeServer({
      get_monthly_totals: () =>
        totalsOf([
          month('2026-09-01', 300000, 100000),
          month('2026-10-01', 300000, 200000),
          month('2026-11-01', 0, 40000, true),
        ]),
    })
    renderSignedIn(<FlowsWidget />)
    await screen.findByText('kept a month, on average')
    expect(server.actions('get_monthly_totals')).toEqual([{ months: FLOW_MONTHS }])
    expect(region()).toHaveTextContent('Are you spending less than you earn?')
    expect(region()).toHaveTextContent('$1,500kept a month, on average')
    expect(within(region()).getByRole('img', { name: 'Money in and out each month' })).toBeVisible()
    await userEvent.click(within(region()).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Money in and out' })
    expect(within(sheet).getByText('Oct 2026')).toBeInTheDocument()
    expect(within(sheet).getByText('Nov 2026, so far')).toBeInTheDocument()
  })

  it('keys red only once a finished month spent more than came in', async () => {
    fakeServer({
      // The running month is over so far, but it is still filling up.
      get_monthly_totals: () =>
        totalsOf([month('2026-10-01', 300000, 100000), month('2026-11-01', 0, 40000, true)]),
    })
    renderSignedIn(<FlowsWidget />)
    await screen.findByText('kept a month, on average')
    expect(region()).not.toHaveTextContent('More out than in')
  })

  it('says in red when more goes out than comes in', async () => {
    fakeServer({ get_monthly_totals: () => totalsOf([month('2026-10-01', 100000, 130000)]) })
    renderSignedIn(<FlowsWidget />)
    await screen.findByText('more out than in, a month')
    expect(screen.getByText('$300', { selector: '.mid-number' })).toHaveClass('money-problem')
    expect(region().querySelector('.flow-key')).toHaveTextContent('In Out More out than in')
  })

  it('waits for the first month to finish before it answers', async () => {
    fakeServer({ get_monthly_totals: () => totalsOf([month('2026-11-01', 0, 40000, true)]) })
    renderSignedIn(<FlowsWidget />)
    expect(
      await screen.findByText('Your first full month shows here once it ends.'),
    ).toBeInTheDocument()
  })

  it('says why the months could not be read', async () => {
    fakeServer({}, { '/api/actions/get_monthly_totals': failing('Database is down') })
    renderSignedIn(<FlowsWidget />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})
