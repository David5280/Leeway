// The choice of account after a save is refused, in both ways of adding a
// pension. The accounts and pensions are read again, and an account chosen
// that has left the list never turns into a new pension by itself, which
// would count one plan twice: made a pension meanwhile, a paystub's figures
// update it, as the refusal said; hidden or typed in, it is chosen again.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing } from '../../../test/fake'
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
const KEPT = 'State Plan is a pension already. Update it instead.'
const KEPT_PAYSTUB = 'State Plan is a pension already. Update it with this paystub instead.'

/** The same plan once made a pension elsewhere, so it is no longer one to offer. */
const STATE_PLAN_KEPT = { ...STATE_PLAN, kind: 'pension' as const }

/** The paystub review with State Plan chosen and Add pension pressed once. */
async function refusedFromPaystub(later: ReturnType<typeof listing>, refusal: string) {
  const server = serve({
    routes: {
      [ACCOUNTS]: inTurn(listing([STATE_PLAN]), later),
      '/api/actions/save_paystub': failing(refusal),
    },
  })
  const { user } = await fromPaystub()
  const form = await review()
  await user.selectOptions(await form.findByRole('combobox', { name: 'Add it to' }), 'State Plan')
  await user.click(form.getByRole('button', { name: 'Add pension' }))
  expect(await form.findByText(refusal)).toBeVisible()
  await waitFor(() => expect(server.actions('list_accounts')).toHaveLength(2))
  return { server, user, form }
}

describe('a refused paystub save', () => {
  it('updates the pension the account became, and never sends a new one', async () => {
    const { server, user, form } = await refusedFromPaystub(
      listing([STATE_PLAN_KEPT]),
      KEPT_PAYSTUB,
    )
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    await waitFor(() =>
      expect(within(where).getByRole('option', { selected: true })).toHaveTextContent(
        'Update State Plan',
      ),
    )
    // Said plainly, and the save names what it now does; no name is asked for a new pension.
    expect(form.getByRole('status')).toHaveTextContent(
      'State Plan is a pension already, so Update pension puts these figures on it',
    )
    expect(form.queryByRole('textbox', { name: 'Pension name' })).toBeNull()
    expect(server.actions('project_retirement').length).toBeGreaterThan(1)

    await user.click(form.getByRole('button', { name: 'Update pension' }))
    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(2))
    expect(server.actions('save_paystub')[1]).toMatchObject({
      pensionAccountId: STATE_PLAN.id,
      newPension: null,
      attachAccountId: null,
    })
  })

  it('asks to choose again when the account left for another reason', async () => {
    // Hidden elsewhere, so it is neither offered nor a pension shown.
    const hidden = 'State Plan is hidden, so a pension on it would not count.'
    const { server, user, form } = await refusedFromPaystub(listing([]), hidden)
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    await waitFor(() =>
      expect(within(where).getByRole('option', { selected: true })).toHaveTextContent(
        'Choose again',
      ),
    )
    expect(form.getByRole('status')).toHaveTextContent('Choose where it goes.')
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    expect(form.queryByRole('textbox', { name: 'Pension name' })).toBeNull()

    // Only the owner's own choice makes it a new pension.
    await user.selectOptions(where, 'A new pension')
    expect(form.getByRole('textbox', { name: 'Pension name' })).toBeVisible()
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(2))
    expect(server.actions('save_paystub')[1]).toMatchObject({ newPension: { name: 'PERA' } })
  })
})

describe('a refused pension typed in', () => {
  it("shows the server's word and asks to choose again, adding no second account", async () => {
    // Made a pension elsewhere after this form listed it, so attach_pension turns it away.
    const server = serve({
      routes: {
        [ACCOUNTS]: inTurn(listing([STATE_PLAN]), listing([STATE_PLAN_KEPT])),
        '/api/actions/attach_pension': failing(KEPT),
      },
    })
    const { user, form } = await byHand()
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    await user.selectOptions(where, 'State Plan')
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    expect(await form.findByRole('alert')).toHaveTextContent(KEPT)
    // The accounts and the pensions are read again, so the plan shows as the pension it is.
    await waitFor(() =>
      expect(within(where).getByRole('option', { selected: true })).toHaveTextContent(
        'Choose again',
      ),
    )
    expect(server.actions('project_retirement').length).toBeGreaterThan(1)
    expect(within(where).queryByRole('option', { name: 'State Plan' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Choose where it goes.')
    expect(form.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(form.getByRole('button', { name: 'Add pension' })).toBeDisabled()
    expect(server.actions('attach_pension')).toHaveLength(1)
    expect(server.actions('create_pension')).toEqual([])
  })
})
