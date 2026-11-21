// Sinking funds on Payday: the total set aside each paycheck, the costs
// Leeway found added or waved off in one tap, and one added by hand.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SinkingFundsView } from '../../../api/client'
import { failing } from '../../../test/fake'
import { fund, fundsView, suggestion } from '../../../test/funds'
import { forecastOf } from '../../../test/overdraft'
import { payView } from '../../../test/pay'
import { planServer, renderPlan } from '../../../test/planning'
import { basisWords, shareWords } from './fundText'

afterEach(() => vi.unstubAllGlobals())

const insurance = fund({ name: 'Car insurance', amountCents: 78_000 })
const water = fund({
  name: 'Water',
  amountCents: 24_000,
  cadence: 'quarter',
  nextDueDate: '2026-12-10',
})
const renewal = suggestion({ name: 'Acme Auto Insurance', amountCents: 64_000 })

function show(view: SinkingFundsView) {
  const server = planServer({
    get_pay: () => payView(),
    get_overdraft_forecast: () => forecastOf([]),
    list_sinking_funds: () => view,
    add_sinking_fund: () => insurance,
  })
  renderPlan('/plan/payday')
  return { server, user: userEvent.setup() }
}

describe('Yearly costs', () => {
  it('leads with what the funds take from each paycheck, and the next one due', async () => {
    show(fundsView([water, insurance]))
    const total = await screen.findByRole('region', { name: 'Yearly costs' })
    // $240 a quarter is $36.82 a paycheck; $780 a year is $29.90.
    expect(total).toHaveTextContent('Set aside each paycheck$67')
    expect(total).toHaveTextContent(
      'For 2 costs, so none lands all at once. Next up: Water, Thu, Dec 10.',
    )
  })

  it('opens the math, cost by cost', async () => {
    const { user } = show(fundsView([insurance]))
    const total = await screen.findByRole('region', { name: 'Yearly costs' })
    expect(total).toHaveTextContent('For one cost')
    await user.click(within(total).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Yearly costs' })
    expect(
      within(sheet).getByText('Set aside each paycheck $30 = Car insurance $30'),
    ).toBeInTheDocument()
    expect(sheet).toHaveTextContent('a year, next Mon, Mar 1')
  })

  it('adds a cost it found in one tap, with its key so it is not offered again', async () => {
    const { server, user } = show(fundsView([], [renewal]))
    const found = await screen.findByRole('region', { name: 'Worth saving for' })
    expect(found).toHaveTextContent('Acme Auto Insurance')
    expect(found).toHaveTextContent('$640 a year, next Tue, Dec 15. $25 each paycheck.')
    expect(found).toHaveTextContent('Charged about a year ago')
    await user.click(within(found).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_sinking_fund')).toEqual([
        {
          name: 'Acme Auto Insurance',
          amountCents: 64_000,
          cadence: 'year',
          dueDate: '2026-12-15',
          sourceKey: 'name:acme auto insurance',
        },
      ]),
    )
  })

  it('waves off a cost it found', async () => {
    const { server, user } = show(fundsView([], [renewal]))
    await user.click(await screen.findByRole('button', { name: 'Not needed' }))
    await waitFor(() =>
      expect(server.actions('dismiss_sinking_fund')).toEqual([{ key: 'name:acme auto insurance' }]),
    )
  })

  it('explains itself before any fund, and adds one by hand', async () => {
    const { server, user } = show(fundsView())
    const card = await screen.findByRole('region', { name: 'Saving for' })
    expect(card).toHaveTextContent(
      'Insurance, registrations and the holidays come round once a year.',
    )
    expect(screen.queryByRole('region', { name: 'Yearly costs' })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Add a yearly cost' }))
    const form = screen.getByRole('form', { name: 'New yearly cost' })
    const add = within(form).getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    await user.type(within(form).getByLabelText('Name'), 'Registration')
    await user.type(within(form).getByLabelText('Costs'), '120')
    await user.click(within(form).getByRole('button', { name: 'Every 3 months' }))
    await user.type(within(form).getByLabelText('Next due'), '2027-04-01')
    await user.click(add)
    await waitFor(() =>
      expect(server.actions('add_sinking_fund')).toEqual([
        { name: 'Registration', amountCents: 12_000, cadence: 'quarter', dueDate: '2027-04-01' },
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New yearly cost' })).not.toBeInTheDocument(),
    )
  })

  it('closes the form on Cancel', async () => {
    const { user } = show(fundsView())
    await user.click(await screen.findByRole('button', { name: 'Add a yearly cost' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New yearly cost' })).not.toBeInTheDocument()
  })

  it('removes a fund', async () => {
    const { server, user } = show(fundsView([insurance]))
    const list = await screen.findByRole('region', { name: 'Saving for' })
    expect(list).toHaveTextContent('Car insurance$780 a year, next Mon, Mar 1')
    await user.click(within(list).getByRole('button', { name: 'Remove Car insurance' }))
    await waitFor(() =>
      expect(server.actions('delete_sinking_fund')).toEqual([{ id: 'fund-car insurance' }]),
    )
  })

  it('shows why the funds could not load', async () => {
    planServer(
      { get_pay: () => payView(), get_overdraft_forecast: () => forecastOf([]) },
      { '/api/actions/list_sinking_funds': failing('Funds failed', 500) },
    )
    renderPlan('/plan/payday')
    expect(await screen.findByText('Funds failed')).toBeVisible()
  })
})

describe('fund words', () => {
  it('shares by budget period while no pay is known', () => {
    expect(shareWords({ shareOf: 'period' })).toBe('each budget period')
  })

  it('says why each cost was suggested', () => {
    expect(basisWords({ basis: 'bill' })).toBe('A bill you track')
    expect(basisWords({ basis: 'repeating' })).toBe('Charged on a schedule')
    expect(basisWords({ basis: 'holidays' })).toBe('December ran above a usual month')
  })
})
