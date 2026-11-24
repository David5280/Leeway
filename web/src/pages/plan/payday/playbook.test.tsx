// The payday playbook at the top of Payday: what was left of the last
// paycheck (green) or how far spending ran over (amber), ideas for the
// leftover, what the new paycheck covers, and one line when cash runs low.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../../api/client'
import { payView } from '../../../test/pay'
import { planServer, renderPlan } from '../../../test/planning'
import { IDEAS, OVER_BUDGET, planOf, playbookOf, SHORT } from '../../../test/playbook'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  planServer({ get_pay: () => payView(), get_payday_playbook: () => playbook })
  renderPlan('/plan/payday')
  return userEvent.setup()
}

const region = (name: string) => screen.findByRole('region', { name })
const regionNames = () => screen.getAllByRole('region').map((one) => one.getAttribute('aria-label'))

describe('Last paycheck', () => {
  it('leads with what was left, big, bold and green', async () => {
    show(playbookOf())
    const card = await region('Last paycheck')
    expect(card).toHaveTextContent('Oct 31 to Nov 13')
    expect(card).toHaveTextContent('Left over$44')
    expect(within(card).getByText('$44', { selector: '.money-xl' })).toHaveClass('money-in')
    expect(card).toHaveTextContent('You spent $230 of the $274 budgeted for everyday spending.')
    // General to detailed: the leftover, then the new paycheck, then the pay behind it.
    await screen.findByRole('region', { name: 'Your pay' })
    const order = regionNames()
    expect(order.indexOf('Last paycheck')).toBeLessThan(order.indexOf('This paycheck'))
    expect(order.indexOf('This paycheck')).toBeLessThan(order.indexOf('Your pay'))
  })

  it('shows spending over budget in amber, never red, with no ideas to share out', async () => {
    show(playbookOf({ budgets: OVER_BUDGET, ideas: IDEAS }))
    const card = await region('Last paycheck')
    expect(card).toHaveTextContent('Over budget by$36')
    expect(within(card).getByText('$36', { selector: '.money-xl' })).toHaveClass('money-warn')
    expect(card).not.toHaveTextContent('ideas')
    expect(screen.queryByRole('region', { name: 'Ideas for what was left' })).toBeNull()
  })

  it('opens budget by budget', async () => {
    const user = show(playbookOf())
    const card = await region('Last paycheck')
    await user.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Last paycheck' })
    expect(within(sheet).getByRole('link', { name: /Groceries/ })).toHaveAttribute(
      'href',
      '/budgets/cat-groceries',
    )
  })

  it('is left out with no pay schedule, while the new paycheck still shows', async () => {
    show(playbookOf({ budgets: null }))
    await region('This paycheck')
    expect(screen.queryByRole('region', { name: 'Last paycheck' })).toBeNull()
  })
})

describe('Ideas for what was left', () => {
  it('lists each idea with its reason and amount, as suggestions only', async () => {
    const user = show(playbookOf({ ideas: IDEAS }))
    expect(await region('Last paycheck')).toHaveTextContent('A few ideas for it are below.')
    const card = await region('Ideas for what was left')
    expect(card).toHaveTextContent('Emergency fundYour emergency fund is short of its target.$30')
    expect(card).toHaveTextContent('New laptopA goal still to reach.$14')
    expect(card).toHaveTextContent('Suggestions only. You move the money yourself.')
    await user.click(within(card).getByRole('button'))
    expect(screen.getByRole('dialog', { name: 'Ideas for what was left' })).toHaveTextContent(
      'Still free',
    )
  })
})

describe('This paycheck', () => {
  it('says what the paycheck leaves after bills and set-asides, pointing to Yearly costs', async () => {
    show(playbookOf())
    const card = await region('This paycheck')
    expect(card).toHaveTextContent('Next payday Fri, Nov 27')
    expect(card).toHaveTextContent('Left for everyday spending$690')
    expect(within(card).getByText('$2,100')).toHaveClass('money-in')
    expect(card).toHaveTextContent('Bills before paydayRent and Phone$1,260')
    expect(card).toHaveTextContent(
      'Set asideGoals, trips and yearly costs (see Yearly costs below)$150',
    )
    expect(card).toHaveTextContent('Safe to spend now$450')
  })

  it('leads with safe to spend while pay is unknown', async () => {
    show(playbookOf({ plan: planOf(undefined, null) }))
    const card = await region('This paycheck')
    expect(card).toHaveTextContent('Safe to spend now$450')
    expect(card).toHaveTextContent('Add your pay below')
    expect(card).not.toHaveTextContent('Left for everyday spending')
  })
})

describe('Cash before payday', () => {
  it('says when checking may dip and opens the full warning in Bills', async () => {
    show(playbookOf({ plan: planOf(undefined, undefined, { short: SHORT }), paydayEstimate: true }))
    const card = await region('Cash before payday')
    expect(card).toHaveTextContent('Checking may go below $0 on Nov 24, before payday.')
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/plan/bills')
    // An estimated payday is a heads up in amber; the cover amount stays in Bills.
    expect(within(card).getByText(/Checking may go below/)).toHaveClass('warn')
    expect(card).not.toHaveTextContent('$100')
  })

  it('turns red when checking is already below zero', async () => {
    show(playbookOf({ plan: planOf(undefined, undefined, { short: { ...SHORT, now: true } }) }))
    const card = await region('Cash before payday')
    expect(within(card).getByText(/already below/)).toHaveClass('over')
  })

  it('is left out while cash lasts', async () => {
    show(playbookOf())
    await region('This paycheck')
    expect(screen.queryByRole('region', { name: 'Cash before payday' })).toBeNull()
  })
})
