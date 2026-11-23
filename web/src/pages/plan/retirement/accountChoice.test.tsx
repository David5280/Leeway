// The choice of account a new pension goes on, in both ways of adding one:
// loading the accounts again when they fail, with focus taken on to the
// choice. What happens after a refusal is in refusedChoice.test.tsx.

import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, failing, holdRequest } from '../../../test/fake'
import {
  byHand,
  fromPaystub,
  inTurn,
  listing,
  review,
  serve,
  STATE_PLAN,
} from '../../../test/newPension'

afterEach(() => vi.unstubAllGlobals())

const ACCOUNTS = '/api/actions/list_accounts'
const NOT_LOADED = 'Leeway could not load your accounts.'

describe('loading the accounts again from the paystub review', () => {
  it('loads them on Try again, offers them and takes focus to the choice', async () => {
    const server = serve({
      routes: { [ACCOUNTS]: inTurn(failing(NOT_LOADED), listing([STATE_PLAN])) },
    })
    const { user } = await fromPaystub()
    const form = await review()
    expect(await form.findByText(NOT_LOADED)).toBeVisible()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()

    await user.click(form.getByRole('button', { name: 'Try again' }))
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    // The button pressed is gone, so focus goes on to the choice it brought back.
    await waitFor(() => expect(where).toHaveFocus())
    expect(form.queryByText(NOT_LOADED)).toBeNull()
    expect(form.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeEnabled()
    expect(server.actions('list_accounts')).toHaveLength(2)
  })

  it('takes focus to the heading when no account could be the pension', async () => {
    const checking = account({ id: 'acct-checking', name: 'Checking' })
    serve({ routes: { [ACCOUNTS]: inTurn(failing(NOT_LOADED), listing([checking])) } })
    const { user } = await fromPaystub()
    const form = await review()
    await user.click(await form.findByRole('button', { name: 'Try again' }))
    const heading = screen.getByRole('heading', { name: 'Add a pension from a paystub' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(form.queryByRole('combobox', { name: 'Add it to' })).toBeNull()
  })

  it('holds Add pension back while they load again, and offers another try if they fail', async () => {
    serve({ routes: { [ACCOUNTS]: failing(NOT_LOADED) } })
    const { user } = await fromPaystub()
    const form = await review()
    const release = holdRequest(ACCOUNTS)
    await user.click(await form.findByRole('button', { name: 'Try again' }))
    // Loading again: the old error is gone, and nothing can be saved without the accounts.
    expect(form.queryByText(NOT_LOADED)).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    release()
    expect(await form.findByText(NOT_LOADED)).toBeVisible()
    expect(form.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
  })
})

describe('loading the accounts again on the form typed in', () => {
  it('says why they failed and holds Add pension back, rather than offering no choice', async () => {
    const server = serve({ routes: { [ACCOUNTS]: failing(NOT_LOADED) } })
    const { form } = await byHand()
    expect(await screen.findByText(NOT_LOADED)).toBeVisible()
    expect(form.queryByRole('combobox', { name: 'Add it to' })).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    expect(server.actions('create_pension')).toEqual([])
  })

  it('loads them on Try again, offers them and takes focus to the choice', async () => {
    serve({ routes: { [ACCOUNTS]: inTurn(failing(NOT_LOADED), listing([STATE_PLAN])) } })
    const { user, form } = await byHand()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    await waitFor(() => expect(where).toHaveFocus())
    expect(screen.queryByText(NOT_LOADED)).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeEnabled()
  })
})
