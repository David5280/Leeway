// The Payday section's pay card: what Leeway found, the one-tap confirm, and
// the owner's own pay in its place.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PayView } from '../../../api/client'
import { failing } from '../../../test/fake'
import { noPay, payView } from '../../../test/pay'
import { planServer, renderPlan } from '../../../test/planning'
import { JOB_STOPPED_NOTE } from './payText'

afterEach(() => vi.unstubAllGlobals())

const yours = { amountCents: 250_000, cadence: 'semimonth' as const, nextPayday: '2026-11-30' }

function show(view: PayView, more: Parameters<typeof planServer>[0] = {}) {
  const server = planServer({ get_pay: () => view, ...more })
  renderPlan('/plan/payday')
  return { server, user: userEvent.setup() }
}

const card = () => screen.findByRole('region', { name: 'Your pay' })

describe('Your pay', () => {
  it('shows the paycheck found, how often and the next payday', async () => {
    show(payView())
    const pay = await card()
    expect(pay).toHaveTextContent('Each paycheck$2,100')
    expect(pay).toHaveTextContent('Every 2 weeks from Acme Corp. Next payday Fri, Nov 27.')
    // Six paychecks two weeks apart settle it: no Estimate label.
    expect(within(pay).queryByText('Estimate')).not.toBeInTheDocument()
    // The paycheck is money in, so it is drawn green.
    expect(within(pay).getByText('$2,100')).toHaveClass('money-in')
  })

  it('labels the pay an estimate while the main job is a guess', async () => {
    show(payView([{ count: 1 }]))
    expect(within(await card()).getByText('Estimate')).toBeVisible()
  })

  it('confirms it in one tap', async () => {
    const { server, user } = show(payView())
    await user.click(await screen.findByRole('button', { name: 'Looks right' }))
    await waitFor(() => expect(server.actions('confirm_pay')).toEqual([{}]))
  })

  it('drops the estimate once confirmed, and offers a change instead of a confirm', async () => {
    show(payView([{}], { confirmed: true }))
    const pay = await card()
    expect(within(pay).queryByText('Estimate')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Looks right' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change my pay' })).toBeVisible()
  })

  it('names a second job beside the first, keeping the main job’s paycheck and payday', async () => {
    // The gig pays weekly, next on Nov 23, before the main job's Nov 27.
    show(payView([{}, { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }]))
    const pay = await card()
    expect(pay).toHaveTextContent('Each paycheck$2,100')
    expect(pay).toHaveTextContent('from Acme Corp and 1 more. Next payday Fri, Nov 27.')
  })

  it('drops the estimate for a confirmed main job, though a second job is still a guess', async () => {
    const view = payView(
      [{}, { name: 'GIG PAYOUT', cents: 40_000, count: 1, last: '2026-11-16' }],
      {
        confirmed: true,
      },
    )
    const { user } = show(view)
    const pay = await card()
    expect(within(pay).queryByText('Estimate')).not.toBeInTheDocument()
    await user.click(within(pay).getByRole('button', { name: /Each paycheck/ }))
    expect(screen.getByRole('dialog', { name: 'Your pay' })).toHaveTextContent(
      "A second job's pay is an estimate",
    )
  })

  it('says when the paychecks changed since the owner confirmed them', async () => {
    const view = payView()
    show({ ...view, found: { ...view.found!, confirmationStale: true } })
    expect(
      await screen.findByText('Your paychecks changed since you said this looked right.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeVisible()
  })

  it('says when the job the owner entered pay for has stopped, and offers to change it', async () => {
    const gig = { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }
    show(payView([gig], { override: yours, forStoppedJob: true }))
    expect(await screen.findByText(JOB_STOPPED_NOTE)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Change my pay' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Use my paychecks' })).toBeVisible()
  })

  it('takes the owner’s own pay, filled in from what was found', async () => {
    const { server, user } = show(payView())
    await user.click(await screen.findByRole('button', { name: 'Not quite' }))
    const form = screen.getByRole('form', { name: 'Enter your pay' })
    expect(within(form).getByLabelText('One paycheck')).toHaveValue('2100.00')
    expect(within(form).getByLabelText('How often you are paid')).toHaveDisplayValue(
      'Every 2 weeks',
    )
    expect(within(form).getByLabelText('Next payday')).toHaveValue('2026-11-27')
    // Pay every two weeks counts from its own day, so no word on paydays moved early.
    const hint = 'Paid early for a weekend or holiday? Enter either day.'
    expect(within(form).queryByText(hint)).not.toBeInTheDocument()
    await user.clear(within(form).getByLabelText('One paycheck'))
    await user.type(within(form).getByLabelText('One paycheck'), '2,500')
    await user.selectOptions(within(form).getByLabelText('How often you are paid'), 'Twice a month')
    expect(within(form).getByText(hint)).toBeVisible()
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('set_pay')).toEqual([
        { pay: { amountCents: 250_000, cadence: 'semimonth', nextPayday: '2026-11-27' } },
      ]),
    )
  })

  it('closes the form on Cancel without saving', async () => {
    const { server, user } = show(payView())
    await user.click(await screen.findByRole('button', { name: 'Not quite' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Enter your pay' })).not.toBeInTheDocument()
    expect(server.actions('set_pay')).toEqual([])
  })

  it('says when the pay is the owner’s own, and goes back to the paychecks', async () => {
    const { server, user } = show(payView([{}], { override: yours }))
    const pay = await card()
    expect(pay).toHaveTextContent('Each paycheck$2,500')
    expect(pay).toHaveTextContent('Twice a month, as you entered it. Next payday Mon, Nov 30.')
    expect(within(pay).queryByText('Estimate')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use my paychecks' }))
    await waitFor(() => expect(server.actions('set_pay')).toEqual([{ pay: null }]))
  })

  it('opens the owner’s own pay as it was entered, cents and all', async () => {
    const { user } = show(payView([], { override: { ...yours, amountCents: 210_050 } }))
    await user.click(await screen.findByRole('button', { name: 'Change my pay' }))
    expect(screen.getByLabelText('One paycheck')).toHaveValue('2100.50')
    // A payday within a year of today either way, as the server takes it.
    expect(screen.getByLabelText('Next payday')).toHaveAttribute('min')
    expect(screen.getByLabelText('Next payday')).toHaveAttribute('max')
  })

  it('removes the owner’s own pay when there are no paychecks to go back to', async () => {
    const { server, user } = show(payView([], { override: yours }))
    expect(await screen.findByRole('button', { name: 'Remove my pay' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Use my paychecks' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove my pay' }))
    await waitFor(() => expect(server.actions('set_pay')).toEqual([{ pay: null }]))
  })

  it('asks for the main job’s pay when two jobs are found', async () => {
    const { user } = show(
      payView([{}, { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }]),
    )
    await user.click(await screen.findByRole('button', { name: 'Not quite' }))
    expect(screen.getByRole('form', { name: 'Enter your pay' })).toHaveTextContent(
      'From your main job. Your other job still counts.',
    )
  })

  it('asks for the pay when no paycheck has been found, and waits for a full answer', async () => {
    const { server, user } = show(noPay)
    expect(await screen.findByText(/has not found a paycheck yet/)).toBeVisible()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('One paycheck'), '1800')
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Next payday'), '2026-11-20')
    await user.click(save)
    await waitFor(() =>
      expect(server.actions('set_pay')).toEqual([
        { pay: { amountCents: 180_000, cadence: 'biweek', nextPayday: '2026-11-20' } },
      ]),
    )
    // No Cancel: with no pay at all, the form is the card.
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('opens how the paycheck adds up to a month', async () => {
    const { user } = show(payView())
    await user.click(within(await card()).getByRole('button', { name: /Each paycheck/ }))
    const sheet = screen.getByRole('dialog', { name: 'Your pay' })
    expect(sheet).toHaveTextContent('Next payday Fri, Nov 27')
    expect(
      within(sheet).getByText(
        'About a month $4,566 = One paycheck $2,100 and Paychecks a year, over 12 months 26.1',
      ),
    ).toBeInTheDocument()
    expect(sheet).toHaveTextContent('Paid every 2 weeks, next Fri, Nov 27')
  })

  it('shows why a confirm failed', async () => {
    const { user } = show(payView(), {})
    vi.unstubAllGlobals()
    planServer(
      { get_pay: () => payView() },
      { '/api/actions/confirm_pay': failing('Leeway has not found a paycheck to confirm yet.') },
    )
    await user.click(await screen.findByRole('button', { name: 'Looks right' }))
    expect(await screen.findByText(/has not found a paycheck to confirm/)).toBeVisible()
  })

  it('shows why the pay could not load', async () => {
    planServer({}, { '/api/actions/get_pay': failing('Server is down', 500) })
    renderPlan('/plan/payday')
    expect(await screen.findByText('Server is down')).toBeVisible()
  })
})
