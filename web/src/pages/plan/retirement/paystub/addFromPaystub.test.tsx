import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { savePaystubSchema } from '../../../../../../server/src/domain/paystubs/paystubs'
import { account, failing, holdRequest, settingsHandlers } from '../../../../test/fake'
import {
  chosenFile,
  cityRead,
  noPensionRead,
  paystubStatus,
  reads,
  savedPaystub,
} from '../../../../test/paystub'
import { planServer, renderPlan, retirementOf } from '../../../../test/planning'
import { pension } from '../../../../test/profile'

afterEach(() => vi.unstubAllGlobals())

const READ_ROUTE = '/api/paystubs/read'
const ADDED = pension({ payCadence: 'semimonth' }, { accountId: 'pension-new' })

/**
 * The Retirement section's server with no pension yet, able to read a
 * paystub unless told otherwise. save_paystub checks what it is sent with
 * the server's own schema, and adding by hand goes to create_pension.
 */
function serve({
  status = paystubStatus(),
  read = reads(cityRead()),
  accounts = [],
  routes = {},
}: {
  status?: ReturnType<typeof paystubStatus>
  read?: () => Response
  accounts?: ReturnType<typeof account>[]
  routes?: Record<string, () => Response>
} = {}) {
  return planServer(
    {
      ...settingsHandlers(),
      project_retirement: () => retirementOf({}, { birthYear: 1986 }),
      list_accounts: () => accounts,
      get_paystub: () => status,
      create_pension: () => ADDED,
      save_paystub: (input) => {
        const { paystub, newPension, attachAccountId } = savePaystubSchema.parse(input)
        // A new account takes the name given; an account Leeway has keeps its own.
        let added = null
        if (newPension) added = { ...ADDED, ...newPension }
        if (attachAccountId) added = { ...ADDED, accountId: attachAccountId }
        return {
          paystub: { ...savedPaystub(), ...paystub, pensionAccountId: added?.accountId ?? null },
          pension: added,
          retirementMonthlyContributionCents: null,
        }
      },
    },
    { [READ_ROUTE]: read, ...routes },
  )
}

/** Presses Add a pension, and gives back the way to choose how. */
async function addPension() {
  const user = userEvent.setup({ applyAccept: false })
  renderPlan('/plan/retirement')
  const pensions = within(await screen.findByRole('region', { name: 'Pensions' }))
  await user.click(pensions.getByRole('button', { name: 'Add a pension' }))
  const choosing = within(await screen.findByRole('region', { name: 'Add a pension' }))
  return { user, choosing }
}

/** Chooses the paystub path and a file, and gives back the review. */
async function fromPaystub() {
  const { user, choosing } = await addPension()
  await user.click(await choosing.findByRole('button', { name: 'Fill it from a paystub' }))
  const importing = within(
    await screen.findByRole('region', { name: 'Add a pension from a paystub' }),
  )
  await user.upload(importing.getByLabelText('Choose a paystub'), chosenFile())
  return { user, importing }
}

const review = async () => within(await screen.findByRole('form', { name: 'Review the paystub' }))

describe('adding a pension', () => {
  it('starts from a paystub when one can be read, with typing it in as the quiet second', async () => {
    serve()
    const { user, choosing } = await addPension()
    const paystub = await choosing.findByRole('button', { name: 'Fill it from a paystub' })
    const byHand = choosing.getByRole('button', { name: 'Enter it myself' })
    expect(paystub).toHaveClass('primary')
    expect(byHand).not.toHaveClass('primary')
    expect(choosing.getByText(/Claude reads it, and you check every figure/)).toBeVisible()
    // Nothing to fill in until the owner picks a way.
    expect(screen.queryByRole('form', { name: 'New pension' })).toBeNull()

    await user.click(byHand)
    expect(await screen.findByRole('form', { name: 'New pension' })).toBeVisible()
  })

  it('goes straight to the form when nothing can read a paystub', async () => {
    serve({ status: paystubStatus(null, false) })
    renderPlan('/plan/retirement')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a pension' }))
    expect(await screen.findByRole('form', { name: 'New pension' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fill it from a paystub' })).toBeNull()
  })

  it('waits to know whether a paystub can be read before offering a way', async () => {
    serve()
    const release = holdRequest('/api/actions/get_paystub')
    renderPlan('/plan/retirement')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a pension' }))
    const waiting = within(screen.getByRole('region', { name: 'Add a pension' }))
    expect(waiting.getByRole('status')).toHaveTextContent('Loading')
    expect(waiting.queryByRole('button', { name: 'Enter it myself' })).toBeNull()
    release()
    expect(await screen.findByRole('button', { name: 'Fill it from a paystub' })).toBeVisible()
  })

  it('closes on cancel, and comes back to the choice when the import is cancelled', async () => {
    serve()
    const { user, choosing } = await addPension()
    await user.click(await choosing.findByRole('button', { name: 'Fill it from a paystub' }))
    const importing = within(screen.getByRole('region', { name: 'Add a pension from a paystub' }))
    await user.click(importing.getByRole('button', { name: 'Cancel' }))
    const again = within(await screen.findByRole('region', { name: 'Add a pension' }))
    await user.click(again.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Add a pension' })).toBeNull()
  })
})

describe('from a paystub', () => {
  it('offers the plan name it read, and adds the pension only once confirmed', async () => {
    const server = serve()
    const { user } = await fromPaystub()
    const form = await review()
    const name = form.getByRole('textbox', { name: 'Pension name' })
    expect(name).toHaveValue('PERA')
    expect(form.getByRole('textbox', { name: 'Member balance' })).toHaveAccessibleDescription(
      "Optional, from your plan's statement",
    )
    // A new pension is being added, so there is no kept one to choose.
    expect(form.queryByRole('combobox', { name: /Update a pension/ })).toBeNull()
    expect(server.actions('save_paystub')).toEqual([])

    await user.clear(name)
    await user.type(name, 'Colorado PERA')
    await user.type(form.getByRole('textbox', { name: 'Member balance' }), '65,000')
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(1))
    expect(server.actions('save_paystub')[0]).toMatchObject({
      paystub: { employerName: 'City of Example', current: { pension: 42_295 } },
      pensionAccountId: null,
      newPension: { name: 'Colorado PERA', balanceCents: 6_500_000 },
      setRetirementContribution: false,
    })
    // One step, on the server: no pension is made apart from the paystub.
    expect(server.actions('create_pension')).toEqual([])
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Add a pension from a paystub' })).toBeNull(),
    )
  })

  it('leaves the name blank and asks for it when the paystub names no plan', async () => {
    const server = serve({ read: reads(cityRead({ pensionPlanName: null })) })
    const { user } = await fromPaystub()
    const form = await review()
    const name = form.getByRole('textbox', { name: 'Pension name' })
    expect(name).toHaveValue('')
    expect(name).toBeRequired()
    // A name of spaces gets past the browser's own check, but not Leeway's.
    await user.type(name, '   ')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByRole('alert')).toHaveTextContent('Name your pension, like Colorado PERA.')
    expect(server.actions('save_paystub')).toEqual([])
  })

  it('refuses a review whose pension contribution was cleared, sending nothing', async () => {
    const server = serve()
    const { user } = await fromPaystub()
    const form = await review()
    await user.clear(form.getByRole('textbox', { name: 'This paycheck: Pension, your share' }))
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByRole('alert')).toHaveTextContent(
      'Enter the pension contribution from your paystub, or add the pension by hand.',
    )
    await user.type(form.getByRole('textbox', { name: 'This paycheck: Pension, your share' }), '1')
    await user.type(form.getByRole('textbox', { name: 'Member balance' }), 'lots')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByRole('alert')).toHaveTextContent('Enter the member balance as an amount.')
    expect(server.actions('save_paystub')).toEqual([])
  })

  it("shows the server's refusal, such as the pension limit, in the review", async () => {
    serve({ routes: { '/api/actions/save_paystub': failing('Leeway keeps up to 10 pensions') } })
    const { user } = await fromPaystub()
    const form = await review()
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(await form.findByText('Leeway keeps up to 10 pensions')).toBeVisible()
  })

  it('says plainly when the paystub shows no pension, and offers to enter it by hand', async () => {
    const server = serve({ read: reads(noPensionRead) })
    const { user, importing } = await fromPaystub()
    expect(await importing.findByRole('status')).toHaveTextContent(
      'Claude found no pension contribution on this paystub, so there is no pension to add from it.',
    )
    expect(screen.queryByRole('form', { name: 'Review the paystub' })).toBeNull()

    // Another paystub can be tried, or the pension typed in.
    await user.click(importing.getByRole('button', { name: 'Try another paystub' }))
    expect(importing.getByLabelText('Choose a paystub')).toBeInTheDocument()
    await user.upload(importing.getByLabelText('Choose a paystub'), chosenFile())
    await user.click(await importing.findByRole('button', { name: 'Enter it myself' }))
    expect(await screen.findByRole('form', { name: 'New pension' })).toBeVisible()
    expect(server.actions('save_paystub')).toEqual([])
  })
})

describe('a new pension from a paystub, on an account Leeway has', () => {
  /** A plan linked from the bank, which the new pension could be. */
  const STATE_PLAN = account({
    id: '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    name: 'State Plan',
    type: 'investment',
    subtype: 'other',
  })

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
