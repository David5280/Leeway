import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, failing, holdRequest } from '../../../../test/fake'
import { addPension, fromPaystub, review, serve } from '../../../../test/newPension'
import { noPensionRead, reads } from '../../../../test/paystub'

afterEach(() => vi.unstubAllGlobals())

/** A plan linked from the bank, which a new pension could be. */
const STATE_PLAN = account({
  id: '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'State Plan',
  type: 'investment',
  subtype: 'other',
})

describe('a new pension from a paystub, on an account Leeway has', () => {
  it('offers no account to add it to when Leeway has none that could be a pension', async () => {
    serve({ accounts: [account({ id: 'acct-checking', name: 'Checking' })] })
    await fromPaystub()
    const form = await review()
    expect(form.queryByRole('combobox', { name: 'Add it to' })).toBeNull()
    expect(form.getByRole('textbox', { name: 'Pension name' })).toBeVisible()
  })

  it('puts the figures on that account instead of adding a second one', async () => {
    const server = serve({ accounts: [STATE_PLAN] })
    const { user } = await fromPaystub()
    const form = await review()
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    expect(where).toHaveAccessibleDescription(
      'An account you already have, so it is not counted twice',
    )
    await user.selectOptions(where, 'State Plan')
    // The account keeps its own name and balance, so neither is asked.
    expect(form.queryByRole('textbox', { name: 'Pension name' })).toBeNull()
    expect(form.queryByRole('textbox', { name: 'Member balance' })).toBeNull()
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(1))
    expect(server.actions('save_paystub')[0]).toMatchObject({
      pensionAccountId: null,
      newPension: null,
      attachAccountId: STATE_PLAN.id,
    })
    // Only accounts the owner shows are offered, since a hidden one counts in no total.
    expect(server.actions('list_accounts')).toContainEqual({ includeHidden: false })
  })

  it('adds a new account after all when the owner picks a new pension', async () => {
    const server = serve({ accounts: [STATE_PLAN] })
    const { user } = await fromPaystub()
    const form = await review()
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    await user.selectOptions(where, 'State Plan')
    await user.selectOptions(where, 'A new pension')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(1))
    expect(server.actions('save_paystub')[0]).toMatchObject({
      newPension: { name: 'PERA', balanceCents: null },
      attachAccountId: null,
    })
  })
})

describe('a pension typed in, on an account Leeway has', () => {
  it("shows the server's word when the account turned out to be a pension already", async () => {
    // Made a pension elsewhere, after this form listed it, so attach_pension turns it away.
    const kept = 'Test State Plan is a pension already. Update it instead.'
    const server = serve({
      accounts: [STATE_PLAN],
      routes: { '/api/actions/attach_pension': failing(kept) },
    })
    const { user, choosing } = await addPension()
    await user.click(await choosing.findByRole('button', { name: 'Enter it myself' }))
    const form = within(await screen.findByRole('form', { name: 'New pension' }))
    await user.selectOptions(await form.findByRole('combobox', { name: 'Add it to' }), 'State Plan')
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    expect(await form.findByRole('alert')).toHaveTextContent(kept)
    expect(server.actions('attach_pension')).toEqual([
      expect.objectContaining({ accountId: STATE_PLAN.id }),
    ])
    // The form stays open, so the owner can choose another account or a new pension.
    expect(form.getByRole('button', { name: 'Add pension' })).toBeEnabled()
  })
})

describe('the steps of adding a pension', () => {
  it('takes focus to each new step, and Cancel on the form goes back to the choice', async () => {
    serve()
    const { user, choosing } = await addPension()
    // Opening the card leaves focus where it was; only a later step moves it.
    expect(choosing.getByRole('heading', { name: 'Add a pension' })).not.toHaveFocus()
    await user.click(await choosing.findByRole('button', { name: 'Enter it myself' }))
    const form = within(await screen.findByRole('form', { name: 'New pension' }))
    expect(screen.getByRole('heading', { name: 'Add a pension' })).toHaveFocus()

    await user.click(form.getByRole('button', { name: 'Cancel' }))
    const again = within(await screen.findByRole('region', { name: 'Add a pension' }))
    expect(again.getByRole('button', { name: 'Fill it from a paystub' })).toBeVisible()
    expect(again.getByRole('heading', { name: 'Add a pension' })).toHaveFocus()

    await user.click(again.getByRole('button', { name: 'Fill it from a paystub' }))
    expect(screen.getByRole('heading', { name: 'Add a pension from a paystub' })).toHaveFocus()
  })

  it('offers the monthly contribution in a group of its own, apart from the new pension', async () => {
    serve()
    await fromPaystub()
    const form = await review()
    const saving = within(form.getByRole('group', { name: 'Retirement saving' }))
    expect(saving.getByRole('checkbox', { name: /401\(k\), 457 and 403\(b\)/ })).toBeVisible()
    const pension = within(form.getByRole('group', { name: 'Your new pension' }))
    expect(pension.queryByRole('checkbox')).toBeNull()
  })

  it('opens the review anyway on request, where a pension with no contribution is still refused', async () => {
    const server = serve({ read: reads(noPensionRead) })
    const { user, importing } = await fromPaystub()
    await user.click(await importing.findByRole('button', { name: 'Check the figures anyway' }))
    const form = await review()
    await user.type(form.getByRole('textbox', { name: 'Pension name' }), 'PERA')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByRole('alert')).toHaveTextContent(
      'Enter the pension contribution from your paystub, or add the pension by hand.',
    )
    // A figure Claude missed, typed in, goes through.
    await user.type(
      form.getByRole('textbox', { name: 'This paycheck: Pension, your share' }),
      '422.95',
    )
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(1))
    expect(server.actions('save_paystub')[0]).toMatchObject({
      paystub: { current: { pension: 42_295 } },
      newPension: { name: 'PERA', balanceCents: null },
    })
  })
})

describe('saving the new pension', () => {
  it('offers Add pension only once the accounts it could go on are known', async () => {
    serve({ accounts: [account({ id: 'acct-plan', name: 'State Plan', type: 'investment' })] })
    const release = holdRequest('/api/actions/list_accounts')
    await fromPaystub()
    const form = await review()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    release()
    expect(await form.findByRole('combobox', { name: 'Add it to' })).toBeVisible()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeEnabled()
  })

  it('says why when the accounts cannot load, rather than leaving the choice out', async () => {
    const server = serve({
      routes: { '/api/actions/list_accounts': failing('Leeway could not load your accounts.') },
    })
    await fromPaystub()
    const form = await review()
    expect(await form.findByText('Leeway could not load your accounts.')).toBeVisible()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    expect(server.actions('save_paystub')).toEqual([])
  })

  it('loads the accounts again on Try again, then offers them and Add pension', async () => {
    // The first load fails and the next one works, as after a dropped connection.
    let loads = 0
    const accounts = () =>
      loads++ === 0
        ? failing('Leeway could not load your accounts.')()
        : Response.json({ result: [STATE_PLAN] })
    const server = serve({ routes: { '/api/actions/list_accounts': accounts } })
    const { user } = await fromPaystub()
    const form = await review()
    expect(await form.findByText('Leeway could not load your accounts.')).toBeVisible()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()

    await user.click(form.getByRole('button', { name: 'Try again' }))
    expect(await form.findByRole('combobox', { name: 'Add it to' })).toBeVisible()
    expect(form.queryByText('Leeway could not load your accounts.')).toBeNull()
    expect(form.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeEnabled()
    expect(server.actions('list_accounts')).toHaveLength(2)
  })

  it('holds Add pension back while the accounts load again, and offers another try if they fail', async () => {
    serve({
      routes: { '/api/actions/list_accounts': failing('Leeway could not load your accounts.') },
    })
    const { user } = await fromPaystub()
    const form = await review()
    const release = holdRequest('/api/actions/list_accounts')
    await user.click(await form.findByRole('button', { name: 'Try again' }))
    // Loading again: the old error is gone, and nothing can be saved without the accounts.
    expect(form.queryByText('Leeway could not load your accounts.')).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    release()
    expect(await form.findByText('Leeway could not load your accounts.')).toBeVisible()
    expect(form.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
  })

  it('saves once however quickly it is sent twice', async () => {
    const server = serve()
    await fromPaystub()
    const form = await screen.findByRole('form', { name: 'Review the paystub' })
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Add pension' })).toBeEnabled(),
    )
    // Two submits in the same moment, before React can show the save as busy.
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Review the paystub' })).toBeNull(),
    )
    expect(server.actions('save_paystub')).toHaveLength(1)
  })
})
