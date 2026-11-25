// Home's lead: what you can spend today, a day and until payday, which figure
// sets it, and its tap-through. Nothing known is said in words, never $0.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Budget } from '../api/client'
import { leewayLead } from '../lib/leewayLead'
import { budgetFor, category, fakeServer, heldToCash, renderSignedIn } from '../test/fake'
import { cashFlow } from '../test/planning'
import { LeewayWidget } from './Leeway'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

/** $800 budgeted, $200 spent: $600 left in the budget. budgetFor puts today at Nov 17. */
const roomy = () => budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }])

/** The budget with the server saying nothing at all is known to spend. */
function nothingKnown(): Budget {
  const budget = heldToCash(budgetFor([category('Fun')], []), 0)
  return { ...budget, spendable: { ...budget.spendable!, limitedBy: 'none', cashKnown: false } }
}

const region = () => screen.getByRole('region', { name: 'Your leeway' })
/** The card once the cash flow it explains has been read. */
const findRegion = () => screen.findByRole('region', { name: 'Your leeway' })

describe('Your leeway', () => {
  it('leads with what you can spend today, a day, and the days until payday', () => {
    renderSignedIn(<LeewayWidget budget={heldToCash(roomy(), 500_000)} />)
    expect(region()).toHaveTextContent('Your leeway today$600')
    // The budget's $600 over the 14 days left in it; payday is 10 days off.
    expect(region()).toHaveTextContent('About $43 a day, with 10 days until payday Fri, Nov 27.')
    expect(region()).toHaveTextContent('Set by your budget; your cash covers it.')
  })

  it('leads with the cash when checking holds less, saying why without red', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ cashCents: 17_800, safeCents: 17_800 }) })
    renderSignedIn(<LeewayWidget budget={heldToCash(roomy(), 17_800)} />)
    expect(await findRegion()).toHaveTextContent('Your leeway today$178')
    const note = screen.getByText(/^Your budget has \$600 left, but you have \$178/)
    expect(note).toHaveClass('muted')
    expect(region().querySelector('.money-problem')).not.toBeInTheDocument()
  })

  it('turns red only when the bills before payday outrun the cash', async () => {
    fakeServer({ get_cash_flow: () => cashFlow() })
    renderSignedIn(<LeewayWidget budget={heldToCash(roomy(), 17_800, [30_000])} />)
    expect(
      await screen.findByText('Checking is $122 short of the bills before payday on Nov 27.'),
    ).toHaveClass('over')
  })

  it('says how far over the budget is, in red, once it is overspent', () => {
    const over = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 90000 }])
    renderSignedIn(<LeewayWidget budget={heldToCash(over, 500_000)} />)
    expect(region()).toHaveTextContent('Over budget$100')
    expect(region()).toHaveTextContent('Past your $800 budget')
    expect(screen.getByText('$100', { selector: '.hero-figure-number' })).toHaveClass(
      'money-problem',
    )
  })

  it('says nothing is known yet, never $0, with neither a budget nor a checking balance', () => {
    renderSignedIn(<LeewayWidget budget={nothingKnown()} />)
    expect(region()).toHaveTextContent('Not known yet.')
    expect(region()).not.toHaveTextContent('$0')
    expect(screen.getByRole('link', { name: 'Set budgets' })).toHaveAttribute('href', '/spending')
    expect(screen.getByRole('link', { name: 'Link a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
  })

  it("falls back to the budget's room to the period's end when the cash could not be read", () => {
    renderSignedIn(<LeewayWidget budget={roomy()} />)
    expect(region()).toHaveTextContent('Your leeway today$600')
    expect(region()).toHaveTextContent('a day for the next 14 days.')
    expect(region()).toHaveTextContent('Set by your budget.')
  })
})

describe("Your leeway's tap-through", () => {
  it('opens the budget math, goals included, when the budget sets it', async () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }], {
      setAsides: [{ goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 15000 }],
    })
    renderSignedIn(<LeewayWidget budget={heldToCash(budget, 500_000)} />)
    await userEvent.click(within(region()).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Your leeway' })
    expect(sheet).toHaveTextContent('Set by your budget. Day 17 of 30.')
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Left to spend $450 = Budgets this period $800 minus spent in them $200 minus set aside for goals $150',
    )
  })

  it('opens the cash math, and the way to Payday, when the cash sets it', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ cashCents: 23_800, safeCents: 17_800 }) })
    renderSignedIn(<LeewayWidget budget={heldToCash(roomy(), 17_800)} />)
    await userEvent.click(within(await findRegion()).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Your leeway' })
    expect(sheet).toHaveTextContent('Set by your cash.')
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Safe to spend $178 = In checking $238 minus bills due before payday $60',
    )
    expect(within(sheet).getByRole('link', { name: 'Open Payday' })).toHaveAttribute(
      'href',
      '/payday',
    )
  })
})

describe('leewayLead', () => {
  it('counts at least one day to spend, even with payday tomorrow', () => {
    const budget = heldToCash(roomy(), 500_000)
    expect(leewayLead(budget, '2026-11-26')?.days).toBe(1)
    expect(leewayLead(budget, '2026-11-17')?.days).toBe(10)
  })

  it('knows nothing with no spendable figure and nothing budgeted', () => {
    expect(leewayLead(budgetFor([category('Fun')], []), '2026-11-17')).toBeNull()
    expect(leewayLead(nothingKnown(), '2026-11-17')).toBeNull()
  })
})
