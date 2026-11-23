import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, holdRequest } from '../../../../test/fake'
import { addPension, fromPaystub, review, serve } from '../../../../test/newPension'
import { chosenFile, cityRead, noPensionRead, paystubStatus, reads } from '../../../../test/paystub'
import { renderPlan } from '../../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

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
