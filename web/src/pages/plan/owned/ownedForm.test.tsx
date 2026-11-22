// The form for something entered by hand never changes what the owner has
// quietly: an amount it can't hold, or a rate it can't read, is refused with a
// sentence, and a home or car is offered loans only, the one tied now included.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, renderPlan } from '../../../test/planning'
import {
  BOTH,
  checking,
  house,
  mortgage,
  NOTHING,
  openRow,
  ownedCard,
  serveOwned as serve,
} from '../../../test/owned'
import type { OwnedAndOwed } from './ownedText'

afterEach(() => vi.unstubAllGlobals())

describe('saving never changes an amount quietly', () => {
  const withChecking: OwnedAndOwed = { ...NOTHING, owned: [checking], ownedCents: -14_210 }

  it('renames an overdrawn account without touching its balance or the day it was entered', async () => {
    const server = serve(withChecking)
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^Second checking/, 'Edit Second checking')
    expect(form.getByRole('textbox', { name: 'Worth about' })).toHaveValue('-142.1')
    // Cash carries no loan, so the form offers none.
    expect(form.queryByRole('combobox', { name: 'Loan on it' })).toBeNull()
    const name = form.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Old checking')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_owned_or_owed')).toEqual([
        { id: checking.id, name: 'Old checking' },
      ]),
    )
  })

  it('keeps a new balance below zero for cash', async () => {
    const server = serve(withChecking)
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^Second checking/, 'Edit Second checking')
    const worth = form.getByRole('textbox', { name: 'Worth about' })
    await user.clear(worth)
    await user.type(worth, '-200')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_owned_or_owed')).toEqual([
        { id: checking.id, name: 'Second checking', amountCents: -20_000 },
      ]),
    )
  })

  it('refuses a loan still owed below zero, saying what to enter, and sends nothing', async () => {
    const server = serve(BOTH)
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^Mortgage/, 'Edit Mortgage')
    const owed = form.getByRole('textbox', { name: 'Still owed' })
    await user.clear(owed)
    await user.type(owed, '-5000')
    await user.click(form.getByRole('button', { name: 'Save' }))
    expect(form.getByRole('alert')).toHaveTextContent(
      "What is still owed can't be below zero. Enter 0 once it is paid off.",
    )
    expect(server.actions('update_owned_or_owed')).toEqual([])
    // Typing again takes the message away.
    await user.type(owed, '0')
    expect(form.queryByRole('alert')).toBeNull()
  })

  it('refuses a home worth less than nothing', async () => {
    const server = serve(NOTHING)
    renderPlan('/plan/net-worth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: 'Add' }))
    const form = within(screen.getByRole('form', { name: 'Add something' }))
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'House')
    await user.type(form.getByRole('textbox', { name: 'Worth about' }), '-1')
    await user.click(form.getByRole('button', { name: 'Add' }))
    expect(form.getByRole('alert')).toHaveTextContent("What it is worth can't be below zero.")
    expect(server.actions('add_owned_or_owed')).toEqual([])
  })
})

describe("a loan's rate", () => {
  it('reads a rate typed with a percent sign', async () => {
    const server = serve(BOTH)
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^Mortgage/, 'Edit Mortgage')
    const rate = form.getByRole('textbox', { name: 'Rate, %' })
    await user.clear(rate)
    await user.type(rate, '5.75%')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_owned_or_owed')).toEqual([
        { id: mortgage.id, name: 'Mortgage', aprPercent: 5.75, monthlyPaymentCents: 180_000 },
      ]),
    )
  })

  it('refuses a rate it cannot read, rather than clearing the saved one', async () => {
    const server = serve(BOTH)
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^Mortgage/, 'Edit Mortgage')
    const rate = form.getByRole('textbox', { name: 'Rate, %' })
    await user.clear(rate)
    await user.type(rate, '-5')
    await user.click(form.getByRole('button', { name: 'Save' }))
    expect(form.getByRole('alert')).toHaveTextContent('Enter the rate as a number, like 6.5.')
    expect(server.actions('update_owned_or_owed')).toEqual([])
  })
})

describe('the loan on a home or car', () => {
  const oldLoan = account({ id: 'acct-old', name: 'Old loan', type: 'loan', hidden: true })
  const tiedToHidden: OwnedAndOwed = {
    ...BOTH,
    owned: [{ ...house, loanId: oldLoan.id, loanName: oldLoan.name, equityCents: null }],
  }
  const accounts = () => [
    account({ id: mortgage.id, name: mortgage.name, type: 'loan' }),
    account({ id: 'acct-visa', name: 'Visa', type: 'credit' }),
    account({ id: 'acct-checking', name: 'Checking' }),
    oldLoan,
  ]

  it('offers loans only, never a card or cash', async () => {
    serve(BOTH, {}, { list_accounts: accounts })
    renderPlan('/plan/net-worth')
    const { form } = await openRow(/^House/, 'Edit House')
    const select = form.getByRole('combobox', { name: 'Loan on it' })
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['None', 'Mortgage']),
    )
  })

  it('shows a hidden loan it is tied to, and None unties it', async () => {
    const server = serve(tiedToHidden, {}, { list_accounts: accounts })
    renderPlan('/plan/net-worth')
    const { user, form } = await openRow(/^House/, 'Edit House')
    const select = form.getByRole('combobox', { name: 'Loan on it' })
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Old loan (hidden)' })).toBeInTheDocument(),
    )
    expect(select).toHaveValue(oldLoan.id)
    await user.selectOptions(select, 'None')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_owned_or_owed')).toEqual([
        { id: house.id, name: 'House', loanId: null },
      ]),
    )
  })

  it('is not asked for anything else owned', async () => {
    serve(NOTHING)
    renderPlan('/plan/net-worth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: 'Add' }))
    const form = within(screen.getByRole('form', { name: 'Add something' }))
    await user.click(form.getByRole('button', { name: 'Other' }))
    expect(form.queryByRole('combobox', { name: 'Loan on it' })).toBeNull()
  })
})

describe('the form card', () => {
  it('comes into view again when another row is opened', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    serve(BOTH)
    renderPlan('/plan/net-worth')
    const user = userEvent.setup()
    const card = within(await ownedCard())
    // Counted from here, since the screen may bring other things into view as it loads.
    const before = scrolled.mock.instances.length
    await user.click(card.getByRole('button', { name: /^House/ }))
    expect(scrolled.mock.instances.slice(before)).toEqual([
      screen.getByRole('region', { name: 'House' }),
    ])
    await user.click(card.getByRole('button', { name: /^Mortgage/ }))
    expect(scrolled.mock.instances.slice(before + 1)).toEqual([
      screen.getByRole('region', { name: 'Mortgage' }),
    ])
    scrolled.mockRestore()
  })
})
