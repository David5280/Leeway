import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bill } from '../../api/client'
import { category, failing, type Handlers } from '../../test/fake'
import { bill, planServer, renderPlan, series } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const phone = bill({ name: 'Phone', amountCents: 6000, anchorDate: '2026-11-20', autopay: true })
const netflix = bill({
  name: 'Netflix',
  kind: 'subscription',
  amountCents: 1549,
  anchorDate: '2026-12-05',
  matchPattern: 'netflix',
})
const streaming = category('Streaming')

/** The server for the bills section; list_bills reflects what create and delete did. */
function serve(start: Bill[] = [phone, netflix], extra: Handlers = {}, routes = {}) {
  let bills = [...start]
  return planServer(
    {
      list_bills: () => ({
        bills,
        monthlyCents: bills.reduce((sum, b) => sum + b.monthlyCents, 0),
        subscriptionsMonthlyCents: bills
          .filter((b) => b.kind === 'subscription')
          .reduce((sum, b) => sum + b.monthlyCents, 0),
      }),
      list_categories: () => [streaming, category('Paycheck', { kind: 'income' })],
      find_recurring: () => [],
      create_bill: (input) => {
        const created = bill(input as Parameters<typeof bill>[0])
        bills = [...bills, created]
        return created
      },
      update_bill: (input) => ({ ...phone, ...input }),
      delete_bill: (input) => {
        bills = bills.filter((b) => b.id !== input.id)
        return { deleted: input.id }
      },
      ...extra,
    },
    routes,
  )
}

const billsCard = () => screen.findByRole('region', { name: 'Bills and subscriptions' })

describe('Bills', () => {
  it('lists bills with how often, when due and the monthly totals', async () => {
    serve()
    renderPlan('/plan/bills')
    const card = within(await billsCard())
    expect(card.getByText(/a month, with/)).toHaveTextContent(
      'About $75 a month, with $15 in subscriptions',
    )
    const phoneRow = card.getByRole('button', { name: /Phone/ })
    expect(phoneRow).toHaveTextContent('Monthly, autopay')
    expect(phoneRow).toHaveTextContent('$60.00')
    expect(phoneRow).toHaveTextContent('Due in 3 days')
    expect(card.getByRole('button', { name: /Netflix/ })).toHaveTextContent('Monthly subscription')
  })

  it('says so when there are no bills', async () => {
    serve([])
    renderPlan('/plan/bills')
    expect(await screen.findByText(/No bills yet/)).toBeInTheDocument()
    expect(screen.queryByText(/a month, with/)).not.toBeInTheDocument()
  })

  it('adds a bill', async () => {
    const server = serve([])
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a bill' }))
    const form = within(screen.getByRole('form', { name: 'New bill' }))
    const add = form.getByRole('button', { name: 'Add bill' })
    expect(add).toBeDisabled()

    await user.type(form.getByLabelText('Name'), 'Gym')
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '45')
    await user.selectOptions(form.getByRole('combobox', { name: 'How often' }), 'Every 2 weeks')
    await user.type(form.getByLabelText('Shows on your statement as'), '  gold gym ')
    await user.selectOptions(form.getByRole('combobox', { name: 'Category' }), 'Streaming')
    await user.click(form.getByRole('button', { name: 'Subscription' }))
    await user.click(form.getByRole('switch', { name: 'Autopay' }))
    await user.clear(form.getByLabelText('Next due'))
    await user.type(form.getByLabelText('Next due'), '2026-12-01')
    // Income categories are not offered for a bill.
    expect(form.queryByRole('option', { name: 'Paycheck' })).not.toBeInTheDocument()
    await user.click(add)

    await waitFor(() => expect(server.actions('create_bill')).toHaveLength(1))
    expect(server.actions('create_bill')[0]).toEqual({
      name: 'Gym',
      kind: 'subscription',
      amountCents: 4500,
      cadence: 'biweek',
      anchorDate: '2026-12-01',
      matchPattern: 'gold gym',
      categoryId: streaming.id,
      autopay: true,
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New bill' })).not.toBeInTheDocument(),
    )
    expect(within(await billsCard()).getByRole('button', { name: /Gym/ })).toBeInTheDocument()
  })

  it('sends no pattern when it is left blank, and closes on cancel', async () => {
    const server = serve([])
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a bill' }))
    const form = within(screen.getByRole('form', { name: 'New bill' }))
    await user.type(form.getByLabelText('Name'), 'Rent')
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '1500')
    await user.type(form.getByLabelText('Shows on your statement as'), '   ')
    await user.click(form.getByRole('button', { name: 'Add bill' }))
    await waitFor(() => expect(server.actions('create_bill')).toHaveLength(1))
    expect(server.actions('create_bill')[0]).toMatchObject({ matchPattern: null })

    await user.click(screen.getByRole('button', { name: 'Add a bill' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New bill' })).not.toBeInTheDocument()
  })

  it('sends no amount when only other fields changed, so an old figure is never sent back', async () => {
    const server = serve()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await billsCard()).getByRole('button', { name: /Phone/ }))
    const form = within(screen.getByRole('form', { name: 'Edit Phone' }))
    await user.clear(form.getByLabelText('Name'))
    await user.type(form.getByLabelText('Name'), 'Mobile')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_bill')).toHaveLength(1))
    const sent = server.actions('update_bill')[0]!
    expect(sent).toMatchObject({ id: phone.id, name: 'Mobile', autopay: true })
    expect(sent).not.toHaveProperty('amountCents')
  })

  it('edits a bill, changing only what the form holds', async () => {
    const server = serve()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await billsCard()).getByRole('button', { name: /Phone/ }))
    const form = within(screen.getByRole('form', { name: 'Edit Phone' }))
    const amount = form.getByRole('textbox', { name: 'Amount' })
    expect(amount).toHaveValue('60')
    await user.clear(amount)
    await user.type(amount, '65.50')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_bill')).toHaveLength(1))
    expect(server.actions('update_bill')[0]).toMatchObject({
      id: phone.id,
      name: 'Phone',
      amountCents: 6550,
      anchorDate: '2026-11-20',
      autopay: true,
    })
  })

  it('opens straight onto a bill from its address, as Coming up links to it', async () => {
    serve()
    renderPlan(`/plan/bills?bill=${netflix.id}`)
    expect(await screen.findByRole('form', { name: 'Edit Netflix' })).toBeInTheDocument()
    const user = userEvent.setup()
    // Another bill opened instead takes its place.
    await user.click(within(await billsCard()).getByRole('button', { name: /Phone/ }))
    expect(screen.getByRole('form', { name: 'Edit Phone' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('deletes a bill', async () => {
    const server = serve()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await billsCard()).getByRole('button', { name: /Netflix/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(server.actions('delete_bill')).toEqual([{ id: netflix.id }]))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Bills and subscriptions' })).queryByRole(
          'button',
          { name: /Netflix/ },
        ),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows why a bill could not be saved', async () => {
    serve([], {}, { '/api/actions/create_bill': failing('Use a real date as YYYY-MM-DD') })
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a bill' }))
    const form = within(screen.getByRole('form', { name: 'New bill' }))
    await user.type(form.getByLabelText('Name'), 'Rent')
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '1500')
    await user.click(form.getByRole('button', { name: 'Add bill' }))
    expect(await form.findByRole('alert')).toHaveTextContent('Use a real date as YYYY-MM-DD')
  })

  it('shows why bills could not load', async () => {
    serve([], {}, { '/api/actions/list_bills': failing('Database is down', 500) })
    renderPlan('/plan/bills')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('Recurring charges found in history', () => {
  const spotify = series({ name: 'SPOTIFY P1A2', key: 'spotify p a', typicalAmountCents: 1199 })
  const power = series({
    name: 'CITY POWER',
    key: 'city power',
    typicalAmountCents: 9000,
    amountVaries: true,
    suggestedKind: 'bill',
    categoryId: streaming.id,
    nextDate: '2026-12-02',
  })
  const pay = series({ name: 'ACME PAYROLL', direction: 'in', typicalAmountCents: 250000 })

  const suggestions = () => screen.findByRole('region', { name: 'Found in your history' })

  it('suggests repeating charges, but not paychecks', async () => {
    serve([], { find_recurring: () => [spotify, power, pay] })
    renderPlan('/plan/bills')
    const card = within(await suggestions())
    expect(card.getByText('SPOTIFY P1A2').parentElement).toHaveTextContent(
      '$11.99 monthly, next around Nov 20',
    )
    expect(card.getByText('CITY POWER').parentElement).toHaveTextContent('About $90.00 monthly')
    expect(card.queryByText('ACME PAYROLL')).not.toBeInTheDocument()
  })

  it('shows nothing when there is nothing to suggest', async () => {
    serve([], { find_recurring: () => [pay] })
    renderPlan('/plan/bills')
    await billsCard()
    await waitFor(() => expect(screen.queryByText('Found in your history')).not.toBeInTheDocument())
  })

  /** A server where tracking makes the bill and takes the charge off the suggestions. */
  function trackingServer() {
    let found = [power]
    let bills: Bill[] = []
    const server = serve([], {
      list_bills: () => ({ bills, monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
      find_recurring: () => found,
      track_recurring: () => {
        const tracked = bill({ name: 'CITY POWER', amountCents: 9000, anchorDate: '2026-12-02' })
        bills = [tracked]
        found = []
        return tracked
      },
      delete_bill: (input) => {
        bills = []
        found = [power]
        return { deleted: input.id }
      },
    })
    return server
  }

  it('tracks a suggestion as a bill in one tap, and says so in a toast', async () => {
    const server = trackingServer()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await suggestions()).getByRole('button', { name: 'Track' }))
    expect(await screen.findByRole('status')).toHaveTextContent('CITY POWER added to Bills')
    expect(server.actions('track_recurring')).toEqual([{ key: 'city power' }])
    // No form to fill in: the bill is listed already, and can be opened to change it.
    expect(screen.queryByRole('form', { name: 'New bill' })).not.toBeInTheDocument()
    expect(within(await billsCard()).getByRole('button', { name: /CITY POWER/ })).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Found in your history' })).toBeNull(),
    )
  })

  it('undoes the tracking from the toast', async () => {
    const server = trackingServer()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await suggestions()).getByRole('button', { name: 'Track' }))
    await user.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }),
    )
    await waitFor(() => expect(server.actions('delete_bill')).toEqual([{ id: 'bill-city power' }]))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // The charge is suggested again, and the bill is gone.
    expect(within(await suggestions()).getByText('CITY POWER')).toBeVisible()
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Bills and subscriptions' })).queryByRole(
          'button',
          { name: /CITY POWER/ },
        ),
      ).toBeNull(),
    )
  })

  it('shows why Undo failed after the last suggestion was tracked and its card went', async () => {
    let found = [power]
    serve(
      [],
      {
        find_recurring: () => found,
        track_recurring: () => {
          found = []
          return bill({ name: 'CITY POWER', amountCents: 9000, anchorDate: '2026-12-02' })
        },
      },
      { '/api/actions/delete_bill': failing('Could not undo it') },
    )
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await suggestions()).getByRole('button', { name: 'Track' }))
    // Nothing left to suggest, so the card goes; the toast stays.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Found in your history' })).toBeNull(),
    )
    await user.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }),
    )
    expect(await screen.findByText('Could not undo it')).toBeVisible()
  })

  it('closes the toast, keeping the bill', async () => {
    const server = trackingServer()
    renderPlan('/plan/bills')
    const user = userEvent.setup()
    await user.click(within(await suggestions()).getByRole('button', { name: 'Track' }))
    // It also goes by itself after TOAST_MS (Toast.test.tsx).
    await user.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Close' }),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(server.actions('delete_bill')).toEqual([])
  })

  it('shows why a charge could not be tracked', async () => {
    serve(
      [],
      { find_recurring: () => [spotify] },
      { '/api/actions/track_recurring': failing('Could not track it') },
    )
    renderPlan('/plan/bills')
    await userEvent
      .setup()
      .click(within(await suggestions()).getByRole('button', { name: 'Track' }))
    expect(await screen.findByText('Could not track it')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stops suggesting a charge that is not a bill', async () => {
    const server = serve([], { find_recurring: () => [spotify] })
    renderPlan('/plan/bills')
    await userEvent
      .setup()
      .click(within(await suggestions()).getByRole('button', { name: 'Not a bill' }))
    await waitFor(() =>
      expect(server.actions('dismiss_recurring')).toEqual([{ key: 'spotify p a' }]),
    )
  })

  it('shows why a charge could not be dismissed, or suggestions could not load', async () => {
    serve(
      [],
      { find_recurring: () => [spotify] },
      { '/api/actions/dismiss_recurring': failing('Try again') },
    )
    renderPlan('/plan/bills')
    await userEvent
      .setup()
      .click(within(await suggestions()).getByRole('button', { name: 'Not a bill' }))
    expect(await screen.findByText('Try again')).toBeInTheDocument()
  })

  it('shows why suggestions could not load', async () => {
    serve([], {}, { '/api/actions/find_recurring': failing('History is unavailable', 500) })
    renderPlan('/plan/bills')
    expect(await screen.findByText('History is unavailable')).toBeInTheDocument()
  })
})
