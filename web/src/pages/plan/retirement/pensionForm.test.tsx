import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsHandlers } from '../../../test/fake'
import { paystubStatus } from '../../../test/paystub'
import { planServer, renderPlan, retirementOf } from '../../../test/planning'
import { pension } from '../../../test/profile'

afterEach(() => vi.unstubAllGlobals())

/** Colorado PERA with a contribution, its pay and its formula's figures. */
const PERA = pension({
  contribution: { kind: 'percent', percent: 11 },
  grossPayCents: 250_000,
  payCadence: 'biweek',
  serviceYears: 8,
  multiplierPercent: 2.5,
})

/** The Retirement section's server, with the pensions given and no paystub reader. */
function serve(pensions = [PERA]) {
  return planServer({
    ...settingsHandlers(),
    project_retirement: () => retirementOf({ pensions }, { birthYear: 1986 }),
    list_accounts: () => [],
    get_paystub: () => paystubStatus(null, false),
    create_pension: () => PERA,
    update_pension: () => PERA,
  })
}

/** Every plan figure the disclosure holds, by its accessible name. */
const DETAILS = [
  'Gross pay each paycheck',
  'Employer adds, percent of pay',
  'Monthly benefit from your statement',
  'Years of service',
  'Monthly salary the formula uses',
  'Multiplier, percent per year',
  'Benefit starts at age',
]

describe('adding a pension by hand', () => {
  it('asks for a name and balance first, with every plan detail folded away', async () => {
    serve([])
    renderPlan('/plan/retirement')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a pension' }))
    const form = within(await screen.findByRole('form', { name: 'New pension' }))
    expect(form.getByLabelText('Name')).toBeVisible()
    expect(form.getByRole('textbox', { name: 'Member balance' })).toHaveAccessibleDescription(
      "Optional, from your plan's statement",
    )
    const more = form.getByText('More details (optional)')
    expect(more.closest('details')).not.toHaveAttribute('open')
    for (const name of DETAILS) expect(form.getByRole('textbox', { name })).not.toBeVisible()
    expect(form.getByRole('combobox', { name: 'Contribution type' })).not.toBeVisible()

    // Unfolded, each detail says in one line what it is for.
    await user.click(more)
    for (const name of DETAILS) {
      const figure = form.getByRole('textbox', { name })
      expect(figure).toBeVisible()
      expect(figure).toHaveAccessibleDescription(/\w+/)
    }
    expect(form.getByRole('combobox', { name: 'Contribution type' })).toHaveAccessibleDescription(
      'What each paycheck pays in',
    )
  })

  it('adds a pension with its name alone, every detail left not known', async () => {
    const server = serve([])
    renderPlan('/plan/retirement')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a pension' }))
    const form = within(await screen.findByRole('form', { name: 'New pension' }))
    await user.type(form.getByLabelText('Name'), 'Colorado PERA')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    await waitFor(() => expect(server.actions('create_pension')).toHaveLength(1))
    expect(server.actions('create_pension')[0]).toEqual({
      ...pension().plan,
      name: 'Colorado PERA',
      balanceCents: null,
    })
  })
})

describe("changing a kept pension's figures", () => {
  it('shows its details open, with the figures it keeps', async () => {
    const server = serve()
    renderPlan('/plan/retirement')
    const user = userEvent.setup()
    const pensions = within(await screen.findByRole('region', { name: 'Pensions' }))
    await user.click(pensions.getByRole('button', { name: 'Edit figures' }))
    const form = within(await screen.findByRole('form', { name: 'Pension figures' }))
    expect(form.getByText('More details (optional)').closest('details')).toHaveAttribute('open')
    expect(form.getByRole('textbox', { name: 'Multiplier, percent per year' })).toBeVisible()
    expect(form.getByRole('textbox', { name: 'Multiplier, percent per year' })).toHaveValue('2.5')
    expect(form.getByRole('textbox', { name: 'Percent of pay' })).toHaveValue('11')
    // The name and balance belong to the account, so they are not asked again.
    expect(form.queryByLabelText('Name')).toBeNull()

    // Folding the details away keeps what was typed in them.
    await user.type(form.getByRole('textbox', { name: 'Benefit starts at age' }), '60')
    await user.click(form.getByText('More details (optional)'))
    await user.click(form.getByText('More details (optional)'))
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_pension')).toHaveLength(1))
    expect(server.actions('update_pension')[0]).toMatchObject({
      accountId: 'pension-1',
      multiplierPercent: 2.5,
      serviceYears: 8,
      benefitAge: 60,
    })
  })
})
