// Sinking funds on Payday, in one Yearly costs card: the total set aside
// each budget period (what safe to spend holds back), a calm note for a cost
// due too soon, the costs Leeway found added or waved off in one tap, and
// the funds opened, removed or added by hand.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SinkingFundsView } from '../../../api/client'
import { failing } from '../../../test/fake'
import { fund, fundsView, suggestion } from '../../../test/funds'
import { payView } from '../../../test/pay'
import { planServer, renderPlanning } from '../../../test/planning'
import { basisWords, firstShort } from './fundText'

afterEach(() => vi.unstubAllGlobals())

const insurance = fund({ name: 'Car insurance', amountCents: 78_000 })
const water = fund({
  name: 'Water',
  amountCents: 24_000,
  cadence: 'quarter',
  nextDueDate: '2026-12-10',
})
const renewal = suggestion({ name: 'Acme Auto Insurance', amountCents: 64_000 })
const bill = suggestion({
  name: 'Registration',
  amountCents: 12_000,
  key: 'bill:bill-1',
  billId: 'bill-1',
  basis: 'bill',
})

function show(view: SinkingFundsView) {
  const server = planServer({
    get_pay: () => payView(),
    list_sinking_funds: () => view,
    add_sinking_fund: () => insurance,
  })
  renderPlanning('/payday')
  return { server, user: userEvent.setup() }
}

/** The one Yearly costs card, once it has loaded. */
const yearlyCosts = () => screen.findByRole('region', { name: 'Yearly costs' })

describe('Yearly costs', () => {
  it('leads with what the funds hold back each budget period, and the next one due', async () => {
    show(fundsView([water, insurance]))
    const card = await yearlyCosts()
    // $240 a quarter is $80 a month; $780 a year is $65.
    expect(card).toHaveTextContent('Set aside each month$145')
    expect(card).toHaveTextContent(
      'For 2 costs, so none lands all at once. Next up: Water, Thu, Dec 10.',
    )
    // The funds stay folded away until asked for.
    expect(within(card).queryByRole('group', { name: 'Saving for' })).not.toBeInTheDocument()
  })

  it('says calmly when a cost lands before its shares cover it', async () => {
    const { user } = show(fundsView([{ ...insurance, shortCents: 52_000 }]))
    const card = await yearlyCosts()
    expect(card).toHaveTextContent('Car insurance: $520 short by Mon, Mar 1, set aside more now.')
    await user.click(within(card).getByRole('button', { name: 'Your costs' }))
    const list = within(card).getByRole('group', { name: 'Saving for' })
    expect(list).toHaveTextContent('$520 short by Mon, Mar 1, set aside more now.')
  })

  it('opens the math, cost by cost', async () => {
    const { user } = show(fundsView([insurance]))
    const card = await yearlyCosts()
    expect(card).toHaveTextContent('For one cost')
    await user.click(within(card).getByRole('button', { name: /show how it adds up/ }))
    const sheet = screen.getByRole('dialog', { name: 'Yearly costs' })
    expect(
      within(sheet).getByText('Set aside each month $65 = Car insurance $65'),
    ).toBeInTheDocument()
    expect(sheet).toHaveTextContent('a year, next Mon, Mar 1')
  })

  it('adds a cost it found in one tap, with its key so it is not offered again', async () => {
    const { server, user } = show(fundsView([insurance], [renewal]))
    const found = await screen.findByRole('group', { name: 'Worth saving for' })
    expect(found).toHaveTextContent(
      'Acme Auto Insurance$640 a year, next Tue, Dec 15. Charged about a year ago.',
    )
    await user.click(within(found).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_sinking_fund')).toEqual([
        {
          name: 'Acme Auto Insurance',
          amountCents: 64_000,
          cadence: 'year',
          dueDate: '2026-12-15',
          sourceKey: renewal.key,
        },
      ]),
    )
  })

  it('adds a bill by its id alone, so the fund follows the bill', async () => {
    const { server, user } = show(fundsView([], [bill]))
    const found = await screen.findByRole('group', { name: 'Worth saving for' })
    expect(found).toHaveTextContent('A bill you track')
    await user.click(within(found).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(server.actions('add_sinking_fund')).toEqual([{ billId: 'bill-1' }]))
  })

  it('waves off a cost it found', async () => {
    const { server, user } = show(fundsView([], [renewal]))
    await user.click(await screen.findByRole('button', { name: 'Not needed' }))
    await waitFor(() =>
      expect(server.actions('dismiss_sinking_fund')).toEqual([{ key: renewal.key }]),
    )
  })

  it('explains itself before any fund, and adds one by hand', async () => {
    const { server, user } = show(fundsView())
    const card = await yearlyCosts()
    expect(card).toHaveTextContent(
      'Insurance, registrations and the holidays come round once a year. Saving a little each month',
    )
    expect(card).not.toHaveTextContent('Set aside')
    await user.click(within(card).getByRole('button', { name: 'Add a yearly cost' }))
    const form = screen.getByRole('form', { name: 'New yearly cost' })
    const add = within(form).getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    // Enter before the form is whole sends nothing.
    await user.type(within(form).getByLabelText('Name'), 'Registration{Enter}')
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

  it('opens the funds, removes one, adds another, and folds them away again', async () => {
    const { server, user } = show(fundsView([insurance]))
    const card = await yearlyCosts()
    await user.click(within(card).getByRole('button', { name: 'Your costs' }))
    const list = within(card).getByRole('group', { name: 'Saving for' })
    expect(list).toHaveTextContent('Car insurance$780 a year, next Mon, Mar 1')
    expect(list).not.toHaveTextContent('short')
    await user.click(within(list).getByRole('button', { name: 'Remove Car insurance' }))
    await waitFor(() =>
      expect(server.actions('delete_sinking_fund')).toEqual([{ id: 'fund-car insurance' }]),
    )
    await user.click(within(card).getByRole('button', { name: 'Add a yearly cost' }))
    expect(screen.getByRole('form', { name: 'New yearly cost' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Hide costs' }))
    expect(within(card).queryByRole('group', { name: 'Saving for' })).not.toBeInTheDocument()
  })

  it('shows why the funds could not load', async () => {
    planServer(
      { get_pay: () => payView() },
      { '/api/actions/list_sinking_funds': failing('Funds failed', 500) },
    )
    renderPlanning('/payday')
    expect(await screen.findByText('Funds failed')).toBeVisible()
  })
})

describe('fund words', () => {
  it('finds the soonest fund its shares will not cover in time', () => {
    const short = { ...insurance, shortCents: 52_000 }
    expect(firstShort(fundsView([water, insurance]))).toBeUndefined()
    expect(firstShort(fundsView([water, short]))).toBe(short)
  })

  it('says why each cost was suggested', () => {
    expect(basisWords({ basis: 'bill' })).toBe('A bill you track')
    expect(basisWords({ basis: 'renewal' })).toBe('Charged about a year ago')
    expect(basisWords({ basis: 'holidays' })).toBe('December ran above a usual month')
  })
})
