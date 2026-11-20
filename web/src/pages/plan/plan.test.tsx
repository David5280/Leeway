import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, CashFlow } from '../../api/client'
import { failing } from '../../test/fake'
import {
  account,
  cashFlow,
  debtPlans,
  planServer,
  renderPlan,
  retirementOf,
} from '../../test/planning'
import { worthPoint } from '../../test/worth'

afterEach(() => vi.unstubAllGlobals())

const emptyBills = { bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }

/** Everything the bills section needs, so other parts can be looked at on the default section. */
const quietBills = {
  list_bills: () => emptyBills,
  list_categories: () => [],
  find_recurring: () => [],
}

describe('Plan screen', () => {
  it('opens on bills and switches sections', async () => {
    planServer({
      ...quietBills,
      list_goals: () => [],
      list_accounts: () => [],
      get_net_worth: () => ({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] }),
      project_retirement: () => retirementOf(),
    })
    renderPlan('/plan')
    const user = userEvent.setup()
    expect(await screen.findByRole('region', { name: 'Bills and subscriptions' })).toBeVisible()
    const sections = within(screen.getByRole('group', { name: 'Plan section' }))
    expect(sections.getByRole('button', { name: 'Bills' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(sections.getByRole('button', { name: 'Goals' }))
    expect(await screen.findByRole('button', { name: 'Add a goal' })).toBeVisible()
    await user.click(sections.getByRole('button', { name: 'Debts' }))
    expect(await screen.findByText(/No credit cards or loans/)).toBeVisible()
    await user.click(sections.getByRole('button', { name: 'Net worth' }))
    expect(await screen.findByRole('region', { name: 'Net worth over time' })).toBeVisible()
    await user.click(sections.getByRole('button', { name: 'Retirement' }))
    expect(await screen.findByRole('region', { name: 'Retirement projection' })).toBeVisible()
  })

  it('shows bills for an address it does not know', async () => {
    planServer(quietBills)
    renderPlan('/plan/somewhere')
    expect(await screen.findByRole('region', { name: 'Bills and subscriptions' })).toBeVisible()
  })
})

describe('Until payday', () => {
  async function show(flow: CashFlow) {
    planServer({ ...quietBills, get_cash_flow: () => flow })
    renderPlan('/plan')
    const card = await screen.findByRole('region', { name: 'Until payday' })
    await within(card).findByText(/in checking and savings/)
    return card
  }

  it('shows what is left a day, the cash, the bills and when payday is', async () => {
    const card = await show(cashFlow())
    expect(card).toHaveTextContent('$144 a day for the next 10 days.')
    expect(card).toHaveTextContent('$1,500 in checking and savings, minus $60 in bills.')
    expect(card).toHaveTextContent('Next payday Fri, Nov 27.')
    expect(within(card).getByText('Phone').parentElement).toHaveTextContent('Nov 20Phone$60.00')
  })

  it('draws the cash dropping with each bill to payday, against $0, and names the bills', async () => {
    const card = await show(cashFlow())
    expect(
      within(card).getByRole('heading', { name: 'Will the cash last until payday?' }),
    ).toBeVisible()
    expect(
      within(card).getByRole('img', { name: 'Cash until payday' }),
    ).toHaveAccessibleDescription(
      'Cash from $1,500 today to $1,440 on payday, Fri, Nov 27, at its lowest $1,440 on Nov 20.',
    )
    expect(card).toHaveTextContent('Stay above: $0')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 640,
    } as DOMRect)
    const hit = within(card).getByTestId('chart-hit')
    // Points: today, the day before the phone bill, the bill's day, payday.
    fireEvent.pointerMove(hit, { clientX: 260 })
    expect(card.querySelector('.chart-readout')).toHaveTextContent('Nov 20$1,440Phone due')
    fireEvent.pointerMove(hit, { clientX: 630 })
    expect(card.querySelector('.chart-readout')).toHaveTextContent('Nov 27$1,440')
    expect(card.querySelector('.chart-readout')).not.toHaveTextContent('due')
    vi.restoreAllMocks()
  })

  it('leaves the line out when payday is today', async () => {
    const card = await show(
      cashFlow({ nextPayday: '2026-11-17', billsDue: [], daysUntilPayday: 0 }),
    )
    expect(within(card).queryByRole('img')).not.toBeInTheDocument()
  })

  it('says how short the bills leave you, and flags a missed one', async () => {
    const card = await show(
      cashFlow({
        cashCents: 1000,
        billsDue: [
          { billId: 'w', name: 'Water', dueDate: '2026-11-05', amountCents: 9000, overdue: true },
        ],
        billsDueCents: 9000,
        leftAfterBillsCents: -8000,
        perDayCents: 0,
        daysUntilPayday: 1,
      }),
    )
    expect(card).toHaveTextContent('$80 short of the bills due before payday.')
    expect(within(card).getByText('No payment found')).toBeInTheDocument()
  })

  it('says where the payday came from', async () => {
    const card = await show(
      cashFlow({
        paydaySource: 'detected_income',
        nextPayday: '2026-11-20',
        expectedPayCents: 250000,
        daysUntilPayday: 1,
      }),
    )
    expect(card).toHaveTextContent('a day for the next 1 day.')
    expect(card).toHaveTextContent(
      'Next payday looks like Fri, Nov 20, about $2,500, going by your past deposits.',
    )
  })

  it('falls back to the end of the budget period', async () => {
    const card = await show(cashFlow({ paydaySource: 'period_end', nextPayday: '2026-12-01' }))
    expect(card).toHaveTextContent(
      'No paycheck found yet, so this runs to the end of your budget period, Tue, Dec 1.',
    )
  })

  it('shows why it could not load', async () => {
    planServer(quietBills, { '/api/actions/get_cash_flow': failing('No accounts yet', 500) })
    renderPlan('/plan')
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument()
  })
})

describe('Debts', () => {
  const rewards = account({
    id: 'acct-rewards',
    name: 'Rewards card',
    type: 'credit',
    balanceCents: 200000,
    aprPercent: 24.99,
    minimumPaymentCents: 6000,
  })
  const loan = account({
    id: 'acct-loan',
    name: 'Personal loan',
    type: 'loan',
    balanceCents: 50000,
  })
  const paidOff = account({ id: 'acct-paid', name: 'Old card', type: 'credit', balanceCents: 0 })
  const hidden = account({ id: 'acct-h', name: 'Hidden card', type: 'credit', hidden: true })
  const checking = account({ id: 'acct-c', name: 'Checking' })
  const rewardsDebt = {
    id: rewards.id,
    name: rewards.name,
    balanceCents: 200000,
    aprBps: 2499,
    minimumCents: 6000,
  }
  const loanDebt = {
    id: loan.id,
    name: loan.name,
    balanceCents: 50000,
    aprBps: 999,
    minimumCents: 2500,
  }

  function serve(accounts: Account[], plans = debtPlans([rewardsDebt, loanDebt])) {
    return planServer({
      ...quietBills,
      list_accounts: () => accounts,
      update_account: (input) => ({ ...loan, ...input }),
      plan_debt_payoff: (input) => ({ ...plans, extraCents: input.extraCents }),
    })
  }

  const debtsCard = () => screen.findByRole('region', { name: 'Your debts' })

  it('lists only cards and loans that are owed, with their terms', async () => {
    serve([rewards, loan, paidOff, hidden, checking])
    renderPlan('/plan/debts')
    const card = within(await debtsCard())
    expect(card.getAllByRole('form').map((f) => f.getAttribute('aria-label'))).toEqual([
      'Rewards card terms',
      'Personal loan terms',
    ])
    expect(card.getByRole('textbox', { name: 'Rewards card interest rate' })).toHaveValue('24.99')
    expect(card.getByRole('textbox', { name: 'Rewards card monthly payment' })).toHaveValue('60')
    expect(card.getByRole('textbox', { name: 'Personal loan interest rate' })).toHaveValue('')
    expect(card.getByRole('textbox', { name: 'Personal loan monthly payment' })).toHaveAttribute(
      'placeholder',
      'Payment',
    )
  })

  it('saves a debt’s rate and payment once something changed', async () => {
    const server = serve([rewards, loan])
    renderPlan('/plan/debts')
    const user = userEvent.setup()
    const terms = within(await screen.findByRole('form', { name: 'Personal loan terms' }))
    const save = terms.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(terms.getByRole('textbox', { name: 'Personal loan interest rate' }), '9.99')
    await user.type(terms.getByRole('textbox', { name: 'Personal loan monthly payment' }), '25')
    await user.click(save)
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: loan.id, aprPercent: 9.99, minimumPaymentCents: 2500 },
      ]),
    )
  })

  it('compares the strategies and lists the payoff order', async () => {
    serve([rewards, loan])
    renderPlan('/plan/debts')
    const user = userEvent.setup()
    const plan = within(await screen.findByRole('region', { name: 'Payoff plan' }))
    expect(await plan.findByRole('group', { name: 'Avalanche plan' })).toHaveTextContent(
      'Aug 20303 years 9 months, $1,249 interest',
    )
    expect(plan.getByText(/a month in all/)).toHaveTextContent('Paying $85 a month in all.')
    const order = () =>
      plan.getAllByText(/^(Rewards card|Personal loan)$/).map((e) => e.textContent)
    // Listed in the order they are paid off: the small loan clears before the card.
    expect(order()).toEqual(['Personal loan', 'Rewards card'])
    await user.click(plan.getByRole('button', { name: 'Snowball' }))
    expect(plan.getByText(/smallest balance first/)).toBeInTheDocument()
  })

  it('asks for an extra amount and plans with it', async () => {
    const server = serve([rewards, loan])
    renderPlan('/plan/debts')
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Payoff plan' })
    await user.type(screen.getByRole('textbox', { name: 'Extra each month' }), '100')
    await waitFor(() =>
      expect(server.actions('plan_debt_payoff')).toContainEqual({ extraCents: 10000 }),
    )
  })

  it('names debts left out for missing terms, and asks for one when none have terms', async () => {
    serve(
      [rewards, loan],
      debtPlans([rewardsDebt], 0, [
        { id: loan.id, name: 'Personal loan', missing: ['aprPercent', 'minimumPaymentCents'] },
      ]),
    )
    renderPlan('/plan/debts')
    expect(
      await screen.findByText('Left out until they have terms: Personal loan.'),
    ).toBeInTheDocument()
  })

  it('asks for a rate when no debt can be planned yet', async () => {
    serve([loan], debtPlans([]))
    renderPlan('/plan/debts')
    expect(await screen.findByText(/Add an interest rate for a debt above/)).toBeInTheDocument()
  })

  it('says when payments never pay a debt off', async () => {
    const stuck = { ...rewardsDebt, aprBps: 3000, minimumCents: 3000 }
    serve([rewards], debtPlans([stuck]))
    renderPlan('/plan/debts')
    const plan = within(await screen.findByRole('region', { name: 'Payoff plan' }))
    expect(await plan.findByRole('group', { name: 'Minimums only plan' })).toHaveTextContent(
      'NeverNever, at these payments',
    )
  })

  it('shows why accounts could not load', async () => {
    planServer(quietBills, { '/api/actions/list_accounts': failing('Database is down', 500) })
    renderPlan('/plan/debts')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('Net worth', () => {
  const history = [worthPoint('2026-06-01', -50000), worthPoint('2026-11-17', 700000)]

  it('leads with the figure, owned less owed, then whether it is growing', async () => {
    const server = planServer({
      ...quietBills,
      get_net_worth: () => ({
        assetsCents: 820000,
        liabilitiesCents: 120000,
        netWorthCents: 700000,
        history,
      }),
    })
    renderPlan('/plan/net-worth')
    expect(await screen.findByRole('region', { name: 'Net worth' })).toHaveTextContent(
      'Net worth$7,000$8,200 owned, less $1,200 owed',
    )
    const chart = screen.getByRole('region', { name: 'Net worth over time' })
    expect(chart).toHaveTextContent('Is your net worth growing?')
    expect(chart).toHaveTextContent('Up $7,500 since Jun 2026')
    expect(screen.getByRole('img', { name: 'Net worth over time' })).toHaveAccessibleDescription(
      'Net worth from −$500 on Jun 1 to $7,000 today.',
    )
    // Where it started is the level to stay above.
    expect(chart).toHaveTextContent('Where you started: −$500')
    // A tapped day says what was owned and owed then.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 640,
    } as DOMRect)
    fireEvent.pointerMove(within(chart).getByTestId('chart-hit'), { clientX: 630 })
    expect(chart.querySelector('.chart-readout')).toHaveTextContent('$7,000 owned$0 owed')
    vi.restoreAllMocks()
    // A house or a car counts once it is added by hand, in Settings.
    expect(screen.getByRole('link', { name: 'Settings, then Accounts' })).toHaveAttribute(
      'href',
      '/settings/accounts',
    )

    await userEvent.setup().click(screen.getByRole('button', { name: '5 years' }))
    await waitFor(() => expect(server.actions('get_net_worth')).toContainEqual({ days: 1825 }))
  })

  it('marks a negative net worth and explains a short history', async () => {
    planServer({
      ...quietBills,
      get_net_worth: () => ({
        assetsCents: 0,
        liabilitiesCents: 5000,
        netWorthCents: -5000,
        history: history.slice(0, 1),
      }),
    })
    renderPlan('/plan/net-worth')
    const card = await screen.findByRole('region', { name: 'Net worth' })
    expect(within(card).getByText('−$50')).toHaveClass('money-problem')
    expect(screen.getByText(/History builds as balances change/)).toBeInTheDocument()
  })

  it('shows why it could not load', async () => {
    planServer(quietBills, { '/api/actions/get_net_worth': failing('Database is down', 500) })
    renderPlan('/plan/net-worth')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})
