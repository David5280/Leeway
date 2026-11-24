// "Entered by you" on the Net worth section: a home, a car and loans kept by
// hand, added, changed and removed here, and marked as the owner's own figures.
// What the form refuses, and the loans it offers, are in ownedForm.test.tsx.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, sentence } from '../../../test/fake'
import { renderPlanning } from '../../../test/planning'
import { BOTH, house, mortgage, NOTHING, ownedCard, serveOwned as serve } from '../../../test/owned'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('things entered by hand', () => {
  it('groups what is owned and owed, with totals and what is yours after the loan', async () => {
    // Pinned, so the day each was entered reads the same whenever this runs.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
    serve(BOTH)
    renderPlanning('/wealth')
    const card = within(await ownedCard())
    expect(card.getByText('Not from your bank. Update them now and then.')).toBeVisible()
    expect(card.getByRole('group', { name: 'You own' })).toHaveTextContent(/^You own\$320,000/)
    const owned = within(card.getByRole('group', { name: 'You own' }))
    expect(owned.getByText('Home, with Mortgage. Updated Sun, Nov 1')).toBeVisible()
    expect(owned.getByText(sentence('Yours after the loan: $70,000'))).toBeVisible()
    const owed = within(card.getByRole('group', { name: 'You owe' }))
    expect(owed.getByText('Loan at 6.5%. Updated Sun, Nov 1')).toBeVisible()
  })

  it('invites a first one when there is none', async () => {
    serve(NOTHING)
    renderPlanning('/wealth')
    const card = within(await ownedCard())
    expect(
      card.getByText(
        'Add a home, a car or a loan your bank link does not cover, so your net worth counts it.',
      ),
    ).toBeVisible()
    expect(card.queryByRole('group')).toBeNull()
  })

  it('adds a home with the loan against it', async () => {
    const server = serve(NOTHING)
    renderPlanning('/wealth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: 'Add' }))
    const form = within(screen.getByRole('form', { name: 'Add something' }))
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'House')
    await user.type(form.getByRole('textbox', { name: 'Worth about' }), '320,000')
    await user.selectOptions(form.getByRole('combobox', { name: 'Loan on it' }), 'Mortgage')
    await user.click(form.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_owned_or_owed')).toEqual([
        { kind: 'home', name: 'House', amountCents: 32_000_000, loanId: mortgage.id },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add something' })).toBeNull())
  })

  it('adds a loan with its rate and payment', async () => {
    const server = serve(NOTHING)
    renderPlanning('/wealth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: 'Add' }))
    const form = within(screen.getByRole('form', { name: 'Add something' }))
    await user.click(form.getByRole('button', { name: 'Loan' }))
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'Car loan')
    await user.type(form.getByRole('textbox', { name: 'Still owed' }), '12500')
    await user.type(form.getByRole('textbox', { name: 'Rate, %' }), '7.25')
    await user.type(form.getByRole('textbox', { name: 'Monthly payment' }), '350')
    await user.click(form.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_owned_or_owed')).toEqual([
        {
          kind: 'loan',
          name: 'Car loan',
          amountCents: 1_250_000,
          aprPercent: 7.25,
          monthlyPaymentCents: 35_000,
        },
      ]),
    )
  })

  it('changes one from its row, and closes on cancel', async () => {
    const server = serve(BOTH)
    renderPlanning('/wealth')
    const user = userEvent.setup()
    const card = within(await ownedCard())
    await user.click(card.getByRole('button', { name: /^House/ }))
    const form = within(screen.getByRole('form', { name: 'Edit House' }))
    const worth = form.getByRole('textbox', { name: 'Worth about' })
    expect(worth).toHaveValue('320000')
    await user.clear(worth)
    await user.type(worth, '335000')
    await user.click(form.getByRole('button', { name: 'Save' }))
    // The loan it is tied to is unchanged, so it is not sent again.
    await waitFor(() =>
      expect(server.actions('update_owned_or_owed')).toEqual([
        { id: house.id, name: 'House', amountCents: 33_500_000 },
      ]),
    )

    await user.click(card.getByRole('button', { name: /^Mortgage/ }))
    const loanForm = within(screen.getByRole('form', { name: 'Edit Mortgage' }))
    expect(loanForm.getByRole('textbox', { name: 'Rate, %' })).toHaveValue('6.5')
    await user.click(loanForm.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Edit Mortgage' })).toBeNull()
  })

  it('deletes one', async () => {
    const server = serve(BOTH)
    renderPlanning('/wealth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: /^Mortgage/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(server.actions('delete_account')).toEqual([{ id: mortgage.id }]))
  })

  it('says why a save failed, and keeps the form open', async () => {
    serve(BOTH, {
      '/api/actions/update_owned_or_owed': failing('Mortgage is not a loan'),
    })
    renderPlanning('/wealth')
    const user = userEvent.setup()
    await user.click(within(await ownedCard()).getByRole('button', { name: /^House/ }))
    const form = within(screen.getByRole('form', { name: 'Edit House' }))
    await user.click(form.getByRole('button', { name: 'Save' }))
    expect(await form.findByText('Mortgage is not a loan')).toBeVisible()
  })

  it('says why the list could not load', async () => {
    serve(BOTH, { '/api/actions/list_owned_and_owed': failing('Database is down', 500) })
    renderPlanning('/wealth')
    expect(await screen.findByText(/Database is down/)).toBeVisible()
  })
})
