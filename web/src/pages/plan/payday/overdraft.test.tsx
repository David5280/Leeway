// The Payday section's overdraft forecast: an amber card for checking that
// may run short before payday, with the move that would cover it, red only
// when an account is below zero already, and a quiet all-clear otherwise.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverdraftForecast } from '../../../api/client'
import { failing } from '../../../test/fake'
import { checkingInput, forecastOf, RENT } from '../../../test/overdraft'
import { payView } from '../../../test/pay'
import { planServer, renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

function show(forecast: OverdraftForecast) {
  planServer({ get_pay: () => payView(), get_overdraft_forecast: () => forecast })
  renderPlan('/plan/payday')
  return userEvent.setup()
}

describe('Checking until payday', () => {
  it('warns in amber when rent would take checking below zero, naming the move that covers it', async () => {
    show(forecastOf([checkingInput({ bills: [RENT] })]))
    const card = await screen.findByRole('region', { name: 'Everyday before payday' })
    expect(card).toHaveClass('warn-card')
    expect(card).toHaveTextContent('Everyday may run short')
    expect(card).toHaveTextContent('Could go below zero by$200')
    expect(card).toHaveTextContent('On Fri, Nov 20, before payday.')
    expect(card).toHaveTextContent('Moving $200 from Rainy day by Thu, Nov 19 would cover it.')
    expect(within(card).getByText('$200', { selector: '.money-xl' })).toHaveClass('money-warn')
    // It leads the screen, above the pay.
    const regions = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(regions.indexOf('Everyday before payday')).toBeLessThan(regions.indexOf('Your pay'))
    expect(screen.queryByRole('region', { name: 'Checking until payday' })).not.toBeInTheDocument()
  })

  it('draws an account already below zero in red', async () => {
    show(forecastOf([checkingInput({ startCents: -4_000 })]))
    const card = await screen.findByRole('region', { name: 'Everyday before payday' })
    expect(card).toHaveClass('over-card')
    expect(card).toHaveTextContent('Everyday is below zero')
    expect(card).toHaveTextContent('Short by, at its lowest$40')
    expect(card).toHaveTextContent('Before payday, Fri, Nov 27.')
  })

  it('says when no account has enough to spare', async () => {
    show(forecastOf([checkingInput({ bills: [RENT] })], []))
    expect(await screen.findByText('No other account has enough to spare right now.')).toBeVisible()
  })

  it('opens the walk to payday: the balance, the bills and usual spending', async () => {
    const user = show(forecastOf([checkingInput({ bills: [RENT], dailySpendCents: 1_000 })]))
    const card = await screen.findByRole('region', { name: 'Everyday before payday' })
    await user.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Everyday' })
    expect(sheet).toHaveTextContent('Until payday, Fri, Nov 27')
    expect(
      within(sheet).getByText(
        'On payday, before the paycheck −$300 = In the account now $1,000 minus bills paid from it $1,200 minus usual spending, $10 a day $100',
      ),
    ).toBeInTheDocument()
    expect(sheet).toHaveTextContent('At its lowest, −$300 on Thu, Nov 26.')
    expect(within(sheet).getByRole('link', { name: /Rent/ })).toHaveAttribute('href', '/plan/bills')
  })

  it('says quietly that every account lasts, below the pay, opening the closest call', async () => {
    const user = show(
      forecastOf([
        checkingInput(),
        checkingInput({ accountId: 'acct-bills', accountName: 'Bills', startCents: 30_000 }),
      ]),
    )
    const card = await screen.findByRole('region', { name: 'Checking until payday' })
    expect(card).toHaveTextContent(
      'Every checking account stays above zero until payday, Fri, Nov 27. At its lowest, $300 on Tue, Nov 17.',
    )
    const regions = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(regions.indexOf('Checking until payday')).toBeGreaterThan(regions.indexOf('Your pay'))
    await user.click(within(card).getByRole('button'))
    expect(screen.getByRole('dialog', { name: 'Bills' })).toBeVisible()
  })

  it('says one account lasts in the singular', async () => {
    show(forecastOf())
    expect(await screen.findByRole('region', { name: 'Checking until payday' })).toHaveTextContent(
      'Checking stays above zero until payday',
    )
  })

  it('shows nothing without a checking account', async () => {
    show(forecastOf([]))
    await screen.findByRole('region', { name: 'Your pay' })
    expect(screen.queryByRole('region', { name: 'Checking until payday' })).not.toBeInTheDocument()
  })

  it('shows why the forecast could not load', async () => {
    planServer(
      { get_pay: () => payView() },
      { '/api/actions/get_overdraft_forecast': failing('Forecast failed', 500) },
    )
    renderPlan('/plan/payday')
    expect(await screen.findByText('Forecast failed')).toBeVisible()
  })
})
