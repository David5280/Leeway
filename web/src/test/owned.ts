// A fake server for "Entered by you" on the Net worth section: a $250,000
// mortgage and the $320,000 house it is against, and ways to open their rows.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OwnedAndOwed, OwnedItem } from '../pages/plan/owned/ownedText'
import type { Handlers } from './fake'
import { account, planServer } from './planning'

/** A $250,000 mortgage at 6.5%, $1,800 a month, entered on Nov 1. */
export const mortgage: OwnedItem = {
  id: 'acct-mortgage',
  name: 'Mortgage',
  kind: 'loan',
  side: 'owed',
  amountCents: 25_000_000,
  aprPercent: 6.5,
  monthlyPaymentCents: 180_000,
  loanId: null,
  loanName: null,
  equityCents: null,
  updatedOn: '2026-11-01',
  inNetWorth: true,
  enteredByYou: true,
}

/** The $320,000 house the mortgage is against. */
export const house: OwnedItem = {
  ...mortgage,
  id: 'acct-house',
  name: 'House',
  kind: 'home',
  side: 'owned',
  amountCents: 32_000_000,
  aprPercent: null,
  monthlyPaymentCents: null,
  loanId: mortgage.id,
  loanName: mortgage.name,
  equityCents: 7_000_000,
}

/** The house and its mortgage, both counted. */
export const BOTH: OwnedAndOwed = {
  owned: [house],
  owed: [mortgage],
  ownedCents: 32_000_000,
  owedCents: 25_000_000,
}

/** Nothing entered by hand yet. */
export const NOTHING: OwnedAndOwed = { owned: [], owed: [], ownedCents: 0, owedCents: 0 }

/** The Net worth section's server, with the list given and saves that echo back. */
export function serveOwned(list: OwnedAndOwed, routes = {}, extra: Handlers = {}) {
  return planServer(
    {
      list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
      list_categories: () => [],
      find_recurring: () => [],
      get_net_worth: () => ({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] }),
      list_accounts: () => [account({ id: mortgage.id, name: mortgage.name, type: 'loan' })],
      list_owned_and_owed: () => list,
      add_owned_or_owed: (input) => ({ ...house, ...input }),
      update_owned_or_owed: (input) => ({ ...house, ...input }),
      delete_account: (input) => ({ deleted: input.id }),
      ...extra,
    },
    routes,
  )
}

/** The "Entered by you" card, once it has loaded. */
export const ownedCard = () => screen.findByRole('region', { name: 'Entered by you' })

/** Opens a row's form on the Net worth section, and returns the form and a user. */
export async function openRow(name: RegExp, formName: string) {
  const user = userEvent.setup()
  await user.click(within(await ownedCard()).getByRole('button', { name }))
  return { user, form: within(screen.getByRole('form', { name: formName })) }
}

/** An overdrawn checking account kept by hand since before this screen. */
export const checking: OwnedItem = {
  ...house,
  id: 'acct-checking',
  name: 'Second checking',
  kind: 'cash',
  amountCents: -14_210,
  loanId: null,
  loanName: null,
  equityCents: null,
}
