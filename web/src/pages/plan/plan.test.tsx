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
import { noPay } from '../../test/pay'
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
  it('opens on payday and switches sections', async () => {
    planServer({
      ...quietBills,
      get_pay: () => noPay,
      list_goals: () => [],
      list_accounts: () => [],
      get_net_worth: () => ({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] }),
      project_retirement: () => retirementOf(),
    })
    renderPlan('/plan')
    const user = userEvent.setup()
    expect(await screen.findByText(/has not found a paycheck yet/)).toBeVisible()
    const sections = within(screen.getByRole('group', { name: 'Plan section' }))
    expect(sections.getByRole('button', { name: 'Payday' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(sections.getByRole('button', { name: 'Bills' }))
    expect(await screen.findByRole('region', { name: 'Bills and subscriptions' })).toBeVisible()
    // Cash until payday leads the bills, and stays off the other sections.
    expect(screen.getByRole('region', { name: 'Until payday' })).toBeVisible()

    await user.click(sections.getByRole('button', { name: 'Goals' }))
    expect(await screen.findByRole('button', { name: 'Add a goal' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Until payday' })).not.toBeInTheDocument()
    await user.click(sections.getByRole('button', { name: 'Debts' }))
    expect(await screen.findByText(/No credit cards or loans/)).toBeVisible()
    await user.click(sections.getByRole('button', { name: 'Net worth' }))
    expect(await screen.findByRole('region', { name: 'Net worth over time' })).toBeVisible()
    await user.click(sections.getByRole('button', { name: 'Retirement' }))
    expect(await screen.findByRole('region', { name: 'Retirement projection' })).toBeVisible()
  })

  it('shows payday for an address it does not know', async () => {
    planServer({ get_pay: () => noPay })
    renderPlan('/plan/somewhere')
    expect(await screen.findByText(/has not found a paycheck yet/)).toBeVisible()
  })
})

describe('Until payday', () => {
  async function show(flow: CashFlow) {
    planServer({ ...quietBills, get_cash_flow: () => flow })
    renderPlan('/plan/bills')
    // The card is drawn anew once the numbers arrive, so it is found after them.
    await screen.findByText(/in checking/)
    return screen.getByRole('region', { name: 'Until payday' })
  }

  it('leads with what is safe to spend, then checking, the bills and when payday is', async () => {
    const card = await show(cashFlow())
    expect(card).toHaveTextContent('$1,440 safe to spend until payday, after bills.')
    expect(card).toHaveTextContent('$1,500 in checking, minus $60 in bills.')
    expect(card).toHaveTextContent('Next payday Fri, Nov 27.')
    expect(within(card).getByText('Phone').parentElement).toHaveTextContent('Nov 20Phone$60.00')
  })

  it('opens the math from its answer, with the line and the bills outside the button', async () => {
    const card = await show(cashFlow())
    const open = within(card).getByRole('button', { name: /Will the cash last until payday/ })
    expect(open).not.toContainElement(within(card).getByRole('img'))
    expect(open).not.toContainElement(within(card).getByText('Phone'))
    await userEvent.setup().click(open)
    expect(screen.getByRole('dialog', { name: 'Until payday' })).toHaveTextContent('Safe to spend')
  })

  it('draws checking dropping with each bill to payday, close up, and names the bills', async () => {
    const card = await show(cashFlow())
    expect(
      within(card).getByRole('heading', { name: 'Will the cash last until payday?' }),
    ).toBeVisible()
    expect(
      within(card).getByRole('img', { name: 'Checking until payday' }),
    ).toHaveAccessibleDescription(
      'Checking from $1,500 today to $1,440 on payday, Fri, Nov 27, at its lowest $1,440 on Nov 20.',
    )
    // Far above $0, the scale is a close-up so the $60 step shows, with no $0 to stay above.
    expect(card).not.toHaveTextContent('Stay above')
    expect(card).toHaveTextContent('$1,500')
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

  it('leaves the line out when no bill comes before payday, or payday is today', async () => {
    const quiet = await show(cashFlow({ billsDue: [], billsDueCents: 0 }))
    expect(within(quiet).queryByRole('img')).not.toBeInTheDocument()
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
        safeCents: 0,
        shortfallCents: 8000,
        perDayCents: 0,
        daysUntilPayday: 1,
      }),
    )
    expect(card).toHaveTextContent('$80 short of the bills due before payday.')
    expect(within(card).getByText('No payment found')).toBeInTheDocument()
    expect(card).toHaveTextContent('Stay above: $0')
    expect(card).toHaveTextContent('Checking goes below $0 today, when Water comes out.')
    // The line starts at the balance now, before the overdue bill comes out.
    expect(within(card).getByRole('img')).toHaveAccessibleDescription(/^Checking from \$10 today/)
    expect(card.querySelector('.chart-line.problem')).toBeInTheDocument()
  })

  it('draws $0 to stay above once the line comes near it', async () => {
    const card = await show(cashFlow({ cashCents: 10_000, billsDueCents: 6000, safeCents: 4000 }))
    expect(card).toHaveTextContent('Stay above: $0')
    expect(card).not.toHaveTextContent('goes below')
    expect(card.querySelector('.chart-line.problem')).not.toBeInTheDocument()
  })

  it('says when checking is already below $0', async () => {
    const rent = { billId: 'r', name: 'Rent', dueDate: '2026-11-20', amountCents: 9000 }
    const card = await show(
      cashFlow({
        cashCents: 0,
        overdraftCents: 500,
        billsDue: [
          { ...rent, overdue: false },
          { ...rent, billId: 'p', name: 'Power', overdue: false },
        ],
        billsDueCents: 18_000,
        safeCents: 0,
        shortfallCents: 18_500,
      }),
    )
    expect(card).toHaveTextContent('Checking is already below $0.')
    expect(card).toHaveTextContent('$185 short of the bills and overdraft due before payday.')
    expect(card).toHaveTextContent(
      '$0 in checking, minus $180 in bills and $5 to bring an overdraft back to zero.',
    )
  })

  it('names the bills that take checking below $0 together', async () => {
    const rent = { billId: 'r', name: 'Rent', dueDate: '2026-11-20', amountCents: 9000 }
    const later = await show(
      cashFlow({
        cashCents: 10_000,
        billsDue: [
          { ...rent, overdue: false },
          { ...rent, billId: 'p', name: 'Power', overdue: false },
        ],
        billsDueCents: 18_000,
        safeCents: 0,
        shortfallCents: 8_000,
      }),
    )
    expect(later).toHaveTextContent(
      'Checking goes below $0 on Nov 20, when Rent and Power come out.',
    )
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
    expect(card).toHaveTextContent(
      'Next payday looks like Fri, Nov 20, about $2,500, going by your paychecks.',
    )
  })

  it('says when payday is projected from one paycheck', async () => {
    const card = await show(
      cashFlow({
        paydaySource: 'detected_income',
        paydayEstimate: true,
        nextPayday: '2026-11-20',
        expectedPayCents: 250000,
        daysUntilPayday: 3,
      }),
    )
    expect(card).toHaveTextContent(
      'Next payday looks like Fri, Nov 20, about $2,500. An estimate: there is one paycheck from this employer so far.',
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
    renderPlan('/plan/bills')
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
  // Its bank stopped sharing it, so its balance is an old one.
  const unshared = account({
    id: 'acct-u',
    name: 'Unshared card',
    type: 'credit',
    unsharedAt: '2026-11-04T15:00:00Z',
  })
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
    serve([rewards, loan, paidOff, hidden, unshared, checking])
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
        // History from long ago, so every range has more to show.
        historyStart: '2020-01-01',
        estimatedBefore: null,
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
    // Where it started is the level to stay above, its words at the far end, clear of the line's start.
    expect(chart).toHaveTextContent('Where you started: −$500')
    expect(within(chart).getByText(/Where you started/)).toHaveAttribute('text-anchor', 'end')
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
    // The chart card is the chart alone; the hero figure above is what opens the math.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chart).toHaveAttribute('data-static', 'chart')
    expect(within(chart).queryByRole('button', { name: /Is your net worth growing/ })).toBeNull()
    await userEvent
      .setup()
      .click(within(screen.getByRole('region', { name: 'Net worth' })).getByRole('button'))
    expect(screen.getByRole('dialog', { name: 'Net worth' })).toBeVisible()
  })

  it('marks a negative net worth and explains a short history', async () => {
    planServer({
      ...quietBills,
      get_net_worth: () => ({
        assetsCents: 0,
        liabilitiesCents: 5000,
        netWorthCents: -5000,
        history: history.slice(0, 1),
        historyStart: '2026-06-01',
        estimatedBefore: null,
      }),
    })
    renderPlan('/plan/net-worth')
    const card = await screen.findByRole('region', { name: 'Net worth' })
    expect(within(card).getByText('−$50')).toHaveClass('money-problem')
    expect(screen.getByText(/History builds as balances change/)).toBeInTheDocument()
  })

  it('redraws for each range, notes the estimate, and offers no range past the history', async () => {
    // Only Date is faked, so ranges count back from a known day: Nov 17, 2026.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
    const server = planServer({
      ...quietBills,
      get_net_worth: (input) => ({
        assetsCents: 500000,
        liabilitiesCents: 0,
        netWorthCents: 500000,
        history:
          Number(input.days) === 90
            ? [worthPoint('2026-08-19', 520000), worthPoint('2026-11-17', 500000)]
            : [worthPoint('2026-03-14', 220000), worthPoint('2026-11-17', 500000)],
        // Rebuilt from transactions back to March; recorded from Nov 17.
        historyStart: '2026-03-14',
        estimatedBefore: '2026-11-17',
      }),
    })
    renderPlan('/plan/net-worth')
    const chart = await screen.findByRole('region', { name: 'Net worth over time' })
    const line = () => screen.getByRole('img', { name: 'Net worth over time' })
    await waitFor(() =>
      expect(line()).toHaveAccessibleDescription(
        'Net worth from $2,200 on Mar 14 to $5,000 today. Before Nov 17, 2026, estimated from transactions. History starts Mar 14, 2026.',
      ),
    )
    expect(chart).toHaveTextContent('Before Nov 17, 2026, estimated from transactions.')
    // Five years would draw the same line as one, so it cannot be picked.
    expect(screen.getByRole('button', { name: '5 years' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1 year' })).toBeEnabled()

    await userEvent.setup().click(screen.getByRole('button', { name: '3 months' }))
    await waitFor(() =>
      expect(line()).toHaveAccessibleDescription(
        'Net worth from $5,200 on Aug 19 to $5,000 today. Before Nov 17, 2026, estimated from transactions.',
      ),
    )
    expect(server.actions('get_net_worth')).toEqual([{ days: 365 }, { days: 90 }])
    vi.useRealTimers()
  })

  it('shows why it could not load', async () => {
    planServer(quietBills, { '/api/actions/get_net_worth': failing('Database is down', 500) })
    renderPlan('/plan/net-worth')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})
