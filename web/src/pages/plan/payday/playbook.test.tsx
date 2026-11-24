// The payday playbook, Payday's lead: this paycheck as a sum (pay, minus
// this pay period's bills, minus what is set aside, is what is left for
// everyday spending), with safe to spend apart from it,
// and on payday what was left of the last paycheck (green) or how far
// spending ran over (amber) first, with ideas for the leftover.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../../api/client'
import { planServer, renderPlanning } from '../../../test/planning'
import { IDEAS, OVER_BUDGET, planOf, playbookOf } from '../../../test/playbook'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  planServer({ get_payday_playbook: () => playbook })
  renderPlanning('/payday')
  return userEvent.setup()
}

const region = (name: string) => screen.findByRole('region', { name })
const regionNames = () => screen.getAllByRole('region').map((one) => one.getAttribute('aria-label'))

describe('Last paycheck', () => {
  it('leads on payday with what was left, big, bold and green', async () => {
    show(playbookOf({ justPaid: true }))
    const card = await region('Last paycheck')
    expect(card).toHaveTextContent('Oct 30 to Nov 12')
    expect(card).toHaveTextContent('Left over$44')
    expect(within(card).getByText('$44', { selector: '.money-xl' })).toHaveClass('money-in')
    expect(card).toHaveTextContent('You spent $230 of the $274 budgeted for everyday spending.')
    // The close-out leads, then the new paycheck.
    await region('This paycheck')
    const order = regionNames()
    expect(order.indexOf('Last paycheck')).toBe(0)
    expect(order.indexOf('Last paycheck')).toBeLessThan(order.indexOf('This paycheck'))
  })

  it('stays out of the way between paydays, so this paycheck leads', async () => {
    show(playbookOf({ ideas: IDEAS }))
    await region('This paycheck')
    expect(regionNames()[0]).toBe('This paycheck')
    expect(screen.queryByRole('region', { name: 'Last paycheck' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ideas for what was left' })).toBeNull()
  })

  it('shows spending over budget in amber, never red, with no ideas to share out', async () => {
    show(playbookOf({ budgets: OVER_BUDGET, ideas: IDEAS, justPaid: true }))
    const card = await region('Last paycheck')
    expect(card).toHaveTextContent('Over budget by$36')
    expect(within(card).getByText('$36', { selector: '.money-xl' })).toHaveClass('money-warn')
    expect(card).not.toHaveTextContent('ideas')
    expect(screen.queryByRole('region', { name: 'Ideas for what was left' })).toBeNull()
  })

  it('opens budget by budget', async () => {
    const user = show(playbookOf({ justPaid: true }))
    const card = await region('Last paycheck')
    await user.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Last paycheck' })
    expect(within(sheet).getByRole('link', { name: /Groceries/ })).toHaveAttribute(
      'href',
      '/spending/cat-groceries',
    )
  })

  it('is left out with no pay schedule, while the new paycheck still shows', async () => {
    show(playbookOf({ budgets: null, justPaid: true }))
    await region('This paycheck')
    expect(screen.queryByRole('region', { name: 'Last paycheck' })).toBeNull()
  })
})

describe('Ideas for what was left', () => {
  it('lists each idea with its reason and amount, as suggestions only', async () => {
    const user = show(playbookOf({ ideas: IDEAS, justPaid: true }))
    expect(await region('Last paycheck')).toHaveTextContent('A few ideas for it are below.')
    const card = await region('Ideas for what was left')
    expect(card).toHaveTextContent('Emergency fundYour emergency fund is short of its target.$30')
    expect(card).toHaveTextContent('New laptopA goal still to reach. Due Jan 15, 2027.$14')
    expect(card).toHaveTextContent('Suggestions only. You move the money yourself.')
    await user.click(within(card).getByRole('button'))
    expect(screen.getByRole('dialog', { name: 'Ideas for what was left' })).toHaveTextContent(
      'Still free',
    )
  })
})

/** A shown amount as cents: "+$2,100" is 210000 and "−$1,260" is -126000. */
const cents = (text: string) => {
  const value = Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100)
  return text.startsWith('−') ? -value : value
}

describe('This paycheck', () => {
  it('reads as a sum that ends on its own total, which the shown parts add up to', async () => {
    show(playbookOf())
    const card = await region('This paycheck')
    expect(card).toHaveTextContent('Left for everyday spending$690')
    expect(card).toHaveTextContent('From this paycheck, until payday Nov 27.')
    const sum = within(card).getByRole('group', { name: 'How this paycheck adds up' })
    const rows = Array.from(sum.querySelectorAll('.list-row'))
    const names = rows.map((row) => row.querySelector('.playbook-row-name')!.textContent)
    expect(names).toEqual([
      'Pay',
      'Bills this pay period',
      'Set aside',
      'Left for everyday spending',
    ])
    const amounts = rows.map((row) => row.querySelector('.money')!.textContent!)
    expect(amounts).toEqual(['+$2,100', '−$1,260', '−$150', '$690'])
    // What the screen shows adds up: the parts make the total line, and the figure above.
    const [pay, bills, setAside, total] = amounts.map(cents)
    expect(pay! + bills! + setAside!).toBe(total)
    expect(rows.at(-1)).toHaveClass('playbook-total')
    expect(within(sum).getByText('+$2,100')).toHaveClass('money-in')
  })

  it('shows safe to spend now apart from the sum, labelled, so it never reads as the total', async () => {
    show(playbookOf({ plan: planOf(undefined, undefined, { safeToSpendCents: 41_234 }) }))
    const card = await region('This paycheck')
    const sum = within(card).getByRole('group', { name: 'How this paycheck adds up' })
    expect(sum).not.toHaveTextContent('Safe to spend')
    expect(card).toHaveTextContent(
      'Safe to spend nowWhat you can spend today, as Home shows it$412',
    )
  })

  it('says when the pay is only an estimate', async () => {
    show(playbookOf({ paydayEstimate: true }))
    const card = await region('This paycheck')
    expect(card).toHaveTextContent('PayAn estimate until more paychecks show+$2,100')
  })

  it('leads with safe to spend while pay is unknown, with plain totals and a way to add pay', async () => {
    show(playbookOf({ plan: planOf(undefined, null) }))
    const card = await region('This paycheck')
    expect(card).toHaveTextContent('Safe to spend now$450')
    expect(card).toHaveTextContent('Add your pay to see')
    expect(card).toHaveTextContent('Bills this pay periodRent and Phone$1,260')
    expect(card).not.toHaveTextContent('−')
    expect(card).not.toHaveTextContent('Left for everyday spending')
    expect(screen.getByRole('link', { name: 'Add your pay' })).toHaveAttribute(
      'href',
      '/payday/pay',
    )
  })
})
