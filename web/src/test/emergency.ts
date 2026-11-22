// The emergency fund for tests: views of $2,000 a month of Rent and
// Groceries with two accounts, Rainy Day ($500, counted) and Everyday ($900,
// not counted); the fund's goal; and a server for the Goals section.

import { screen, within } from '@testing-library/react'
import type { Goal } from '../api/client'
import type { EmergencyView, FundChoice } from '../lib/emergencyText'
import { category, type Handlers } from './fake'
import { goal, planServer } from './planning'

type Essentials = NonNullable<EmergencyView['essentials']>

/** Essential spending of $2,000 a month, found by Leeway. */
export function essentials(fields: Partial<Essentials> = {}): Essentials {
  return {
    cents: 200_000,
    from: 'spending',
    categories: ['Rent', 'Groceries'],
    categoryIds: ['cat-rent', 'cat-groceries'],
    picked: false,
    ...fields,
  }
}

/** An account on the fund's list, counted and not left out unless told. */
export function fundChoice(
  fields: Partial<FundChoice> & Pick<FundChoice, 'id' | 'name'>,
): FundChoice {
  return {
    balanceCents: 50_000,
    counted: true,
    marked: false,
    leftOut: null,
    otherGoal: null,
    ...fields,
  }
}

export const RAINY = fundChoice({ id: 'acct-rainy', name: 'Rainy Day' })
export const EVERYDAY = fundChoice({
  id: 'acct-check',
  name: 'Everyday',
  balanceCents: 90_000,
  counted: false,
})

/** The offer: no fund yet, one month of $2,000 essentials, $500 put by. */
export function offerView(fields: Partial<EmergencyView> = {}): EmergencyView {
  return {
    goalId: null,
    essentials: essentials(),
    months: 1,
    ownTarget: false,
    targetCents: 200_000,
    savedCents: 50_000,
    monthsCovered: 0.2,
    next: { months: 3, targetCents: 600_000 },
    counts: 'savings',
    accounts: [RAINY, EVERYDAY],
    ...fields,
  }
}

/** The fund once started, counting every savings account. */
export function fundView(fields: Partial<EmergencyView> = {}): EmergencyView {
  return offerView({ goalId: 'goal-emergency', ...fields })
}

/** The fund's goal: $500 of $2,000, following Rainy Day. */
export function fundGoal(fields: Partial<Goal> = {}): Goal {
  return goal({
    id: 'goal-emergency',
    name: 'Emergency fund',
    targetCents: 200_000,
    emergencyMonths: 1,
    followedAccountIds: ['acct-rainy'],
    accountBalanceCents: 50_000,
    ...fields,
  })
}

/** The Goals section's server, with the fund (or its offer) and the goals given. */
export function serveEmergency(
  view: EmergencyView | null,
  goals: Goal[] = [],
  extra: Handlers = {},
) {
  return planServer({
    list_goals: () => goals,
    list_accounts: () => [],
    list_categories: () => [category('Rent'), category('Groceries'), category('Fun')],
    get_emergency_fund: () => view,
    start_emergency_fund: () => fundGoal(),
    change_emergency_fund: () => fundView(),
    update_settings: () => ({}),
    ...extra,
  })
}

/** The fund's card, found by its goal's name. */
export async function fundCard(name = 'Emergency fund') {
  return within(await screen.findByRole('region', { name }))
}
