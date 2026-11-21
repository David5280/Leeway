// The payday playbook at the top of Payday: what was left from the last
// paycheck, green when there is money left, and the plan for the new one,
// every step in priority order, each card opening its math.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../../api/client'
import { failing } from '../../../test/fake'
import { forecastOf } from '../../../test/overdraft'
import { payView } from '../../../test/pay'
import { NEEDS, playbookOf, stepNeed, UNDER_BUDGET } from '../../../test/playbook'
import { planServer, renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  planServer({
    get_pay: () => payView(),
    get_overdraft_forecast: () => forecastOf([]),
    list_sinking_funds: () => ({
      shareOf: 'paycheck',
      cadence: 'biweek',
      funds: [],
      suggestions: [],
      totalShareCents: 0,
    }),
    get_payday_playbook: () => playbook,
  })
  renderPlan('/plan/payday')
  return userEvent.setup()
}

const regionNames = () =>
  screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))

describe('Your last paycheck', () => {
  it('leads with what was left, in green, and says it joins the plan', async () => {
    show(playbookOf({ budgets: UNDER_BUDGET, needs: NEEDS }))
    const card = await screen.findByRole('region', { name: 'Your last paycheck' })
    expect(card).toHaveTextContent('Oct 30 to Nov 12')
    expect(card).toHaveTextContent('Left over$44')
    expect(within(card).getByText('$44', { selector: '.money-xl' })).toHaveClass('money-in')
    expect(card).toHaveTextContent(
      'You spent $230 of the $274 budgeted for everyday spending. It is added to the plan for your paycheck below.',
    )
    // Most general first: the leftover, then the plan, then the pay.
    const regions = regionNames()
    expect(regions.indexOf('Your last paycheck')).toBeLessThan(regions.indexOf('Paycheck plan'))
    expect(regions.indexOf('Paycheck plan')).toBeLessThan(regions.indexOf('Your pay'))
  })

  it('opens the math, budget by budget', async () => {
    const user = show(playbookOf({ budgets: UNDER_BUDGET, needs: NEEDS }))
    const card = await screen.findByRole('region', { name: 'Your last paycheck' })
    await user.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Left over' })
    expect(within(sheet).getByText('Left over $44 = Budgeted $274 minus spent $230')).toBeVisible()
    expect(sheet).toHaveTextContent('Spent $120 of $184')
  })

  it('reads amber when spending ran over, and asks for pay with none known', async () => {
    show(playbookOf({ budgets: [{ name: 'Dining', budgetCents: 9_000, spentCents: 13_000 }] }))
    const card = await screen.findByRole('region', { name: 'Your last paycheck' })
    expect(card).toHaveTextContent('Over budget by$40')
    expect(within(card).getByText('$40', { selector: '.money-xl' })).toHaveClass('money-warn')
    expect(card).toHaveTextContent('Add your pay below to plan what to do with it.')
    expect(screen.queryByRole('region', { name: 'Paycheck plan' })).not.toBeInTheDocument()
  })

  it('says no more when the budget was spent to the dollar', async () => {
    show(
      playbookOf({
        budgets: [{ name: 'Dining', budgetCents: 9_000, spentCents: 9_000 }],
        needs: NEEDS,
      }),
    )
    const card = await screen.findByRole('region', { name: 'Your last paycheck' })
    expect(card.querySelector('.key-figure-caption')!.textContent!.trim()).toBe(
      'You spent $90 of the $90 budgeted for everyday spending.',
    )
    expect(within(card).getByText('$0', { selector: '.money-xl' })).toHaveClass('money-neutral')
  })

  it('shows nothing with no everyday budgets', async () => {
    show(playbookOf({ needs: NEEDS }))
    await screen.findByRole('region', { name: 'Paycheck plan' })
    expect(screen.queryByRole('region', { name: 'Your last paycheck' })).not.toBeInTheDocument()
  })
})

describe('Paycheck plan', () => {
  it('shares out the paycheck and the leftover, most pressing first', async () => {
    show(playbookOf({ budgets: UNDER_BUDGET, needs: NEEDS }))
    const card = await screen.findByRole('region', { name: 'Paycheck plan' })
    expect(card).toHaveTextContent('Plan for your next paycheck')
    expect(card).toHaveTextContent(
      'To plan$2,144Your next paycheck of $2,100 lands Fri, Nov 27, plus $44 left over.',
    )
    const rows = card.querySelectorAll('.plan-steps .list-row')
    expect([...rows].map((row) => row.textContent)).toEqual([
      'Bills before paydayRent$1,500',
      'Everyday spendingYour budgets$184',
      'Savings10% of pay$460',
    ])
    expect(card).toHaveTextContent('Suggestions only. You move the money yourself.')
    expect(card).not.toHaveClass('over-card')
  })

  it('greets a paycheck that just landed, less what ran over', async () => {
    const over = [{ name: 'Dining', budgetCents: 9_000, spentCents: 13_000 }]
    show(playbookOf({ budgets: over, needs: NEEDS, justPaid: true }))
    const card = await screen.findByRole('region', { name: 'Paycheck plan' })
    expect(card).toHaveTextContent('Payday! Here is a plan')
    expect(card).toHaveTextContent(
      'Your paycheck of $2,100 landed Mon, Nov 16, less $40 over budget.',
    )
    expect(screen.getByRole('region', { name: 'Your last paycheck' })).toHaveTextContent(
      'The plan below makes up for it.',
    )
  })

  it('says how far short it falls, so the later steps get less', async () => {
    show(playbookOf({ needs: [...NEEDS, stepNeed('goals', [['Trip', 50_000]])] }))
    const card = await screen.findByRole('region', { name: 'Paycheck plan' })
    // $2,100 covers rent and groceries, then $416 of the trip, and savings last gets nothing.
    expect(card).toHaveTextContent('GoalsTrip$416of $500')
    expect(card).toHaveTextContent('Savings10% of pay$0of $210')
    expect(card).toHaveTextContent('$294 short of everything, so the last steps get less.')
  })

  it('is a problem only when the bills before payday do not fit', async () => {
    show(playbookOf({ needs: [stepNeed('bills', [['Rent', 250_000, '2026-11-20']])] }))
    const card = await screen.findByRole('region', { name: 'Paycheck plan' })
    expect(card).toHaveClass('over-card')
    expect(card).toHaveTextContent('Not enough for the bills before payday. $400 short in all.')
  })

  it('opens every dollar’s job', async () => {
    const user = show(playbookOf({ budgets: UNDER_BUDGET, needs: NEEDS }))
    const card = await screen.findByRole('region', { name: 'Paycheck plan' })
    await user.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Paycheck plan' })
    expect(
      within(sheet).getByText('To plan $2,144 = Paycheck $2,100 plus left over $44'),
    ).toBeVisible()
    expect(sheet).toHaveTextContent('Bills before payday, Fri, Nov 20')
    expect(sheet).toHaveTextContent('Anything still free')
  })

  it('shows why the plan could not load', async () => {
    planServer(
      { get_pay: () => payView(), get_overdraft_forecast: () => forecastOf([]) },
      { '/api/actions/get_payday_playbook': failing('Plan failed', 500) },
    )
    renderPlan('/plan/payday')
    expect(await screen.findByText('Plan failed')).toBeVisible()
  })
})
