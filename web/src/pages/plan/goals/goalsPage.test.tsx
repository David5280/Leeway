// The Goals tab as the map lays it out: what is set aside each paycheck and
// the goal next to land, then "Can I afford it?", the emergency fund, the
// goals in the order they are funded, and the yearly costs; and how each
// reads with nothing in it yet.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../../api/client'
import { fundGoal, fundView } from '../../../test/emergency'
import type { Handlers } from '../../../test/fake'
import { fund, fundsView } from '../../../test/funds'
import { car, orderOf, trip } from '../../../test/goalOrder'
import { planServer, renderPlanning } from '../../../test/planning'
import { planOf, playbookOf } from '../../../test/playbook'
import { NO_FUND_YET } from './GoalsSection'
import { NOTHING_SET_ASIDE } from './lead/leadText'

afterEach(() => vi.unstubAllGlobals())

/** The regions that make up the page, by name, in the order the map gives them. */
const SECTIONS = ['Set aside', 'Can I afford it?', 'Emergency fund', 'Your goals', 'Yearly costs']

/** Goals with these goals and anything else a test sets. */
function show(goals: Goal[], extra: Handlers = {}) {
  planServer({ list_goals: () => goals, list_accounts: () => [], ...extra })
  renderPlanning('/goals')
}

/** The page's sections, by name, in the order they are on the page. */
async function sectionsInOrder(): Promise<string[]> {
  await screen.findByRole('region', { name: 'Yearly costs' })
  await screen.findByRole('region', { name: 'Set aside' })
  return screen
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label') ?? '')
    .filter((name) => SECTIONS.includes(name))
}

describe('the Goals tab', () => {
  it('lays its sections out in the order of the map', async () => {
    const order = orderOf([fundGoal(), trip, car])
    show([fundGoal(), trip, car], {
      get_emergency_fund: () => fundView(),
      get_goal_order: () => order,
      list_sinking_funds: () => fundsView([fund({ name: 'Car insurance', amountCents: 78_000 })]),
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument()
    expect(await sectionsInOrder()).toEqual(SECTIONS)
    // The fund has its own place, so the goals list holds only the others, in order.
    const goals = within(screen.getByRole('region', { name: 'Your goals' }))
    expect(goals.queryByRole('region', { name: 'Emergency fund' })).toBeNull()
    const cards = goals.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(cards.filter((name) => name === 'Trip' || name === 'Car')).toEqual(['Trip', 'Car'])
  })

  it('leads with what is set aside each paycheck and the goal next to land', async () => {
    show([trip, car], { get_goal_order: () => orderOf([trip, car]) })
    const lead = await screen.findByRole('region', { name: 'Set aside' })
    expect(lead).toHaveTextContent('Each paycheck$150')
    expect(lead).toHaveTextContent('Next to land: Trip, Mar 2027.')
  })

  it('opens what makes up the set-aside figure', async () => {
    show([trip])
    const lead = await screen.findByRole('region', { name: 'Set aside' })
    await userEvent.setup().click(within(lead).getByRole('button', { name: /show how it adds up/ }))
    const sheet = screen.getByRole('dialog', { name: 'Set aside' })
    expect(
      within(sheet).getByText(
        'Set aside each paycheck $150 = New laptop $100 plus Car insurance $50',
      ),
    ).toBeInTheDocument()
    expect(sheet).toHaveTextContent('Yearly cost')
  })

  it('counts by the budget period while pay is not known', async () => {
    show([], { get_payday_playbook: () => playbookOf({ plan: planOf(undefined, null) }) })
    const lead = await screen.findByRole('region', { name: 'Set aside' })
    expect(lead).toHaveTextContent('Each month$150')
  })
})

describe('the Goals tab with nothing in it yet', () => {
  it('says what to do first in every section', async () => {
    show([], { get_payday_playbook: () => playbookOf({ plan: planOf([]) }) })
    const lead = await screen.findByRole('region', { name: 'Set aside' })
    expect(lead).toHaveTextContent(NOTHING_SET_ASIDE)
    expect(lead).toHaveTextContent(
      'No goals yet. Start one below, and the next to land shows here.',
    )
    // A lead with no figure has nothing to open.
    expect(within(lead).queryByRole('button')).toBeNull()

    expect(screen.getByRole('region', { name: 'Emergency fund' })).toHaveTextContent(NO_FUND_YET)

    const goals = within(screen.getByRole('region', { name: 'Your goals' }))
    expect(
      goals.getByText(
        'No goals yet. Save for something you want to buy, and Leeway works out what to set aside for it.',
      ),
    ).toBeVisible()
    expect(goals.getByRole('button', { name: 'Save for a purchase' })).toBeVisible()

    const yearly = await screen.findByRole('region', { name: 'Yearly costs' })
    expect(within(yearly).getByRole('button', { name: 'Add a yearly cost' })).toBeVisible()
  })

  it('says so when goals have no date to land yet', async () => {
    show([trip], { get_goal_order: () => orderOf([trip], 0, 'none') })
    const lead = await screen.findByRole('region', { name: 'Set aside' })
    expect(lead).toHaveTextContent(
      'No goal has a date to land yet. Put money toward one and it shows here.',
    )
  })

  it('names the goals list for what else there is once the fund is the only goal', async () => {
    show([fundGoal()], { get_emergency_fund: () => fundView() })
    const goals = within(await screen.findByRole('region', { name: 'Your goals' }))
    expect(goals.getByText(/^Nothing else saved for yet\./)).toBeVisible()
  })
})
