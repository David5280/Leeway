import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pension } from '../../../test/profile'
import { account, failing, settingsHandlers, settingsWith, type Handlers } from '../../../test/fake'
import { planServer, renderPlanning, retirementOf } from '../../../test/planning'
import type { RetirementView } from './fields'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Colorado PERA with the figures an owner reads off a statement and a paystub. */
const PERA = pension(
  {
    contribution: { kind: 'percent', percent: 11 },
    grossPayCents: 250_000,
    payCadence: 'biweek',
    employerContributionPercent: 21.4,
    serviceYears: 8,
    salaryBasisMonthlyCents: 600_000,
    multiplierPercent: 2.5,
    checkedOn: '2026-10-01',
  },
  { balanceCents: 6_500_000 },
)

/** Born in 1986, with $40,000 saved, wanting the $4,000 a month spent lately. */
const SAVER = { retirementCents: 4_000_000, recentMonthlySpendingCents: 400_000 }

const withPension = retirementOf({ ...SAVER, pensions: [PERA] }, { birthYear: 1986 })

/** The Retirement section's server: the view given, pension saves and settings that keep. */
function serve(view: RetirementView, extra: Handlers = {}, routes = {}) {
  return planServer(
    {
      ...settingsHandlers(),
      project_retirement: () => view,
      create_pension: () => PERA,
      attach_pension: () => PERA,
      update_pension: () => PERA,
      list_accounts: () => [],
      ...extra,
    },
    routes,
  )
}

const card = (name: string) => screen.findByRole('region', { name })

/** Opens the form to add a pension by hand, with its plan details unfolded. */
async function addByHand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add a pension' }))
  const form = within(await screen.findByRole('form', { name: 'New pension' }))
  await user.click(form.getByText('More details (optional)'))
  return form
}

describe('the projection', () => {
  it('asks for a birth year before projecting anything', async () => {
    serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByText('Can I stop working on time?')).toBeVisible()
    expect(
      projection.getByText(
        'Add your birth year to see what your savings and any pension could pay.',
      ),
    ).toBeVisible()
    expect(projection.queryByRole('progressbar')).toBeNull()
    expect(projection.queryByRole('img')).toBeNull()
    expect(projection.queryByRole('group')).toBeNull()
    expect(projection.getByText(/not a promise/)).toBeVisible()
  })

  it('shows the range with a pension counted, and never the bank-seen contributions', async () => {
    serve(withPension)
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByText('Can I retire at 65?')).toBeVisible()
    expect(projection.getByText('On track')).toBeVisible()
    expect(projection.getByText(/should cover 35% to 136% of the \$4,000/)).toBeVisible()
    const share = projection.getByRole('progressbar', { name: 'Share of the income you want' })
    expect(share.firstElementChild?.getAttribute('style')).toContain('var(--good)')
    expect(projection.getByRole('img', { name: 'Savings by age' })).toHaveAccessibleDescription(
      'Savings at 40: $40,000. At 65: $57,517 to $147,760, $92,600 in the middle case.',
    )
    expect(
      projection.getByText('Shaded: the low to high case. Line: the middle case.'),
    ).toBeVisible()

    const savings = within(projection.getByRole('group', { name: 'Savings at 65' }))
    expect(savings.getByText('$57,517 to $147,760')).toBeVisible()
    const income = within(projection.getByRole('group', { name: 'Monthly income at 65' }))
    expect(income.getByText('$1,392 to $5,443')).toBeVisible()
    // Income in retirement is money in: a plus and its color.
    const pensionIncome = income.getByText('Pension, entered by you').nextSibling
    expect(pensionIncome).toHaveTextContent('+$4,950 / mo')
    expect(within(pensionIncome as HTMLElement).getByText('+$4,950')).toHaveClass('money-in')
    expect(income.getByText('Savings at 4% a year').nextSibling).toHaveTextContent('+$309 / mo')
    // A pension is retirement saving, so the meter about bank transfers stays out of view.
    expect(projection.queryByText('What am I putting in?')).toBeNull()
    expect(projection.getByText(/\$1,259 more than the \$4,000 you want/)).toBeVisible()
  })

  it('shows a shortfall in the plain color', async () => {
    serve(
      retirementOf(
        { retirementCents: 1_000_000, recentMonthlySpendingCents: 400_000 },
        { birthYear: 1986 },
      ),
    )
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByText('Below target')).toBeVisible()
    const fill = projection.getByRole('progressbar').firstElementChild
    // Not a status: the bar wears the page's own color (Wealth's), like its charts.
    expect(fill?.getAttribute('style')).toContain('var(--place-mark)')
  })

  it('says a figure once when every case agrees, as with nothing saved', async () => {
    serve(retirementOf({ recentMonthlySpendingCents: 400_000 }, { birthYear: 1986 }))
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByRole('img', { name: 'Savings by age' })).toHaveAccessibleDescription(
      'Savings at 40: $0. At 65: $0.',
    )
    const income = within(projection.getByRole('group', { name: 'Monthly income at 65' }))
    expect(income.getByText('$0', { selector: '.mid-number' })).toBeVisible()
    expect(projection.queryByText(/most likely/)).toBeNull()
  })

  it('gives a pension holder short of the target the figures, with no verdict or bar', async () => {
    // Wanting $9,000 a month, more than the pension and savings give.
    serve(
      retirementOf(
        { ...SAVER, recentMonthlySpendingCents: 900_000, pensions: [PERA] },
        { birthYear: 1986 },
      ),
    )
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByText('$1,392 to $5,443 a month')).toBeVisible()
    expect(projection.getByText(/^from your pension and savings at 65/)).toBeVisible()
    expect(projection.queryByRole('progressbar')).toBeNull()
    expect(projection.queryByText(/below target|close|short|instead of/i)).toBeNull()
  })

  it('says when a pension starts after the retirement age, with no verdict for that age', async () => {
    const later = pension({ ...PERA.plan, benefitAge: 67 }, { balanceCents: 6_500_000 })
    serve(retirementOf({ ...SAVER, pensions: [later] }, { birthYear: 1986 }))
    renderPlanning('/wealth/retirement')
    const projection = within(await card('Retirement projection'))
    expect(projection.getByText('Your pension starts at 67')).toBeVisible()
    expect(projection.getByText(/so it gives no verdict at 65\.$/)).toBeVisible()
    expect(projection.queryByRole('progressbar')).toBeNull()
  })

  it('says so when the projection cannot load', async () => {
    planServer({}, { '/api/actions/project_retirement': failing('Database is down', 500) })
    renderPlanning('/wealth/retirement')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('pensions', () => {
  it('invites the owner to add one when there are none', async () => {
    serve(retirementOf())
    renderPlanning('/wealth/retirement')
    expect(within(await card('Pensions')).getByText(/such as Colorado PERA/)).toBeVisible()
  })

  it('shows each pension with its benefit, what goes in and the member balance', async () => {
    serve(withPension)
    renderPlanning('/wealth/retirement')
    const row = within(within(await card('Pensions')).getByRole('group', { name: 'Colorado PERA' }))
    expect(row.getByText('Pension, entered by you')).toBeVisible()
    expect(row.getByText('$1,200 to $4,950 / mo')).toBeVisible()
    expect(
      row.getByText('$1,200 for your service so far, $4,950 with 33 years by 65.'),
    ).toBeVisible()
    expect(row.getByText(/the plan's statement gives the exact figure/)).toBeVisible()
    expect(row.getByText('$275 a paycheck (11% of pay)')).toBeVisible()
    expect(row.getByText(/Your employer adds about \$1,163 a month/)).toBeVisible()
    expect(row.getByText(/Member balance/)).toHaveTextContent(
      'Member balance $65,000, which pays the benefit, so it is not counted again as savings.',
    )
    expect(row.getByText('Checked Oct 1, 2026')).toBeVisible()
  })

  it('leaves out what the owner has not entered', async () => {
    serve(retirementOf({ ...SAVER, pensions: [pension()] }, { birthYear: 1986 }))
    renderPlanning('/wealth/retirement')
    const row = within(within(await card('Pensions')).getByRole('group', { name: 'Colorado PERA' }))
    expect(row.getByText('Benefit not known yet')).toBeVisible()
    expect(row.queryByText(/Member balance/)).toBeNull()
    expect(row.queryByText(/employer/)).toBeNull()
    expect(row.queryByText(/Checked/)).toBeNull()
    // Its income is not known either, so the projection says what is missing.
    const projection = within(await card('Retirement projection'))
    expect(
      projection.getByText("Add your pension's monthly benefit to see whether you are on track."),
    ).toBeVisible()
    expect(projection.queryByRole('progressbar')).toBeNull()
    expect(projection.getByText(/A pension counts here once its monthly benefit/)).toBeVisible()
  })

  it("changes a pension's figures, sending every field", async () => {
    const server = serve(withPension)
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const pensions = within(await card('Pensions'))
    await user.click(pensions.getByRole('button', { name: 'Edit figures' }))
    const form = within(screen.getByRole('form', { name: 'Pension figures' }))
    // The name and balance belong to the account, so the figures form leaves them out.
    expect(form.queryByLabelText('Name')).toBeNull()
    expect(form.getByRole('textbox', { name: 'Percent of pay' })).toHaveValue('11')
    await user.clear(form.getByRole('textbox', { name: 'Years of service' }))
    await user.type(form.getByRole('textbox', { name: 'Years of service' }), '9')
    await user.type(
      form.getByRole('textbox', { name: 'Monthly benefit from your statement' }),
      '2,100',
    )
    await user.click(form.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(server.actions('update_pension')).toHaveLength(1))
    expect(server.actions('update_pension')[0]).toEqual({
      accountId: 'pension-1',
      ...PERA.plan,
      serviceYears: 9,
      statementBenefitMonthlyCents: 210_000,
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Pension figures' })).not.toBeInTheDocument(),
    )
  })

  it('adds a pension with only the figures typed', async () => {
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    expect(screen.getByRole('region', { name: 'Add a pension' })).toBeVisible()

    await user.type(form.getByLabelText('Name'), 'Colorado PERA')
    await user.type(form.getByRole('textbox', { name: 'Member balance' }), '65,000')
    await user.selectOptions(
      form.getByRole('combobox', { name: 'Your contribution' }),
      'An amount each paycheck',
    )
    await user.type(form.getByRole('textbox', { name: 'Amount each paycheck' }), '275')
    await user.selectOptions(form.getByRole('combobox', { name: 'Pay schedule' }), 'Every 2 weeks')
    await user.type(form.getByRole('textbox', { name: 'Employer adds, percent of pay' }), '21.4')
    await user.type(form.getByLabelText('Checked on'), '2026-10-01')
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    await waitFor(() => expect(server.actions('create_pension')).toHaveLength(1))
    expect(server.actions('create_pension')[0]).toEqual({
      ...pension().plan,
      name: 'Colorado PERA',
      balanceCents: 6_500_000,
      contribution: { kind: 'amount', cents: 27_500 },
      payCadence: 'biweek',
      employerContributionPercent: 21.4,
      checkedOn: '2026-10-01',
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New pension' })).not.toBeInTheDocument(),
    )
  })

  it('adds the plan to an account Leeway already has, so it is not counted twice', async () => {
    const server = serve(retirementOf(), {
      list_accounts: () => [
        account({ id: 'acct-checking', name: 'Checking' }),
        account({ id: 'acct-plan', name: 'State Plan', type: 'investment', subtype: 'other' }),
      ],
    })
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    const where = await form.findByRole('combobox', { name: 'Add it to' })
    // Only an account that could hold a pension is offered; a checking account is not.
    expect(
      within(where)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['A new pension', 'State Plan'])
    await user.selectOptions(where, 'State Plan')
    // The account has its own name and balance, so the form stops asking for them.
    expect(form.queryByLabelText('Name')).toBeNull()
    expect(form.queryByRole('textbox', { name: 'Member balance' })).toBeNull()
    await user.type(form.getByRole('textbox', { name: 'Years of service' }), '8')
    await user.click(form.getByRole('button', { name: 'Add pension' }))

    // Only accounts the owner shows are asked for, since a hidden one counts in no total.
    expect(server.actions('list_accounts')).toContainEqual({ includeHidden: false })
    await waitFor(() => expect(server.actions('attach_pension')).toHaveLength(1))
    expect(server.actions('attach_pension')[0]).toEqual({
      ...pension().plan,
      accountId: 'acct-plan',
      serviceYears: 8,
    })
    expect(server.actions('create_pension')).toHaveLength(0)
  })

  it('never turns a percent into dollars when the contribution type changes', async () => {
    serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    const type = form.getByRole('combobox', { name: 'Your contribution' })
    await user.selectOptions(type, 'A percent of gross pay')
    await user.type(form.getByRole('textbox', { name: 'Percent of pay' }), '11')
    await user.selectOptions(type, 'An amount each paycheck')
    // No gross pay to convert through, so it starts blank.
    expect(form.getByRole('textbox', { name: 'Amount each paycheck' })).toHaveValue('')
    await user.type(form.getByRole('textbox', { name: 'Gross pay each paycheck' }), '2500')
    await user.type(form.getByRole('textbox', { name: 'Amount each paycheck' }), '275')
    await user.selectOptions(type, 'A percent of gross pay')
    expect(form.getByRole('textbox', { name: 'Percent of pay' })).toHaveValue('11')
  })

  it('reads each hint with its figure, and each problem out loud', async () => {
    serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    expect(
      form.getByRole('textbox', { name: 'Benefit starts at age' }),
    ).toHaveAccessibleDescription('Blank uses your retirement age')
    expect(form.getByRole('textbox', { name: 'Years of service' })).toHaveAccessibleDescription(
      "Your service so far, from your plan's statement",
    )
    expect(form.getByRole('combobox', { name: 'Pay schedule' })).toHaveAccessibleDescription(
      'How often a paycheck comes',
    )
    // A figure with no hint names nothing.
    await user.selectOptions(
      form.getByRole('combobox', { name: 'Your contribution' }),
      'An amount each paycheck',
    )
    expect(form.getByRole('textbox', { name: 'Amount each paycheck' })).not.toHaveAttribute(
      'aria-describedby',
    )
    await user.type(form.getByLabelText('Name'), 'PERA')
    await user.type(form.getByRole('textbox', { name: 'Years of service' }), 'many')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByRole('alert')).toHaveTextContent('Enter years of service as a number.')
  })

  it('names a figure that is not a number and sends nothing, then closes on cancel', async () => {
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    await user.type(form.getByLabelText('Name'), 'PERA')
    await user.type(form.getByRole('textbox', { name: 'Multiplier, percent per year' }), 'lots')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByText('Enter the multiplier as a number.')).toBeVisible()

    await user.clear(form.getByRole('textbox', { name: 'Multiplier, percent per year' }))
    await user.type(form.getByRole('textbox', { name: 'Member balance' }), 'some')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(form.getByText('Enter the member balance as an amount.')).toBeVisible()
    expect(server.actions('create_pension')).toHaveLength(0)

    await user.click(form.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New pension' })).not.toBeInTheDocument()
  })

  it("shows the server's refusal in the form", async () => {
    serve(
      retirementOf(),
      {},
      {
        '/api/actions/create_pension': failing('Leeway keeps up to 10 pensions'),
      },
    )
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = await addByHand(user)
    await user.type(form.getByLabelText('Name'), 'PERA')
    await user.click(form.getByRole('button', { name: 'Add pension' }))
    expect(await form.findByText('Leeway keeps up to 10 pensions')).toBeVisible()
  })
})

describe('the assumptions', () => {
  it('saves the assumptions typed, and says the projection uses them', async () => {
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'Retirement assumptions' }))
    expect(form.getByRole('textbox', { name: 'Retire at' })).toHaveValue('65')
    expect(form.queryByRole('textbox', { name: /birth/i })).toBeNull()
    await user.type(form.getByRole('textbox', { name: 'Income you want a month' }), '4,000')
    await user.click(form.getByRole('button', { name: 'Save assumptions' }))

    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    expect(server.actions('update_settings')[0]).toEqual({
      retirement: {
        retirementAge: 65,
        returnPercent: 6,
        inflationPercent: 2.5,
        withdrawalPercent: 4,
        monthlyContributionCents: null,
        targetMonthlyIncomeCents: 400_000,
      },
    })
    expect(await form.findByRole('status')).toHaveTextContent(
      'Saved. The projection above uses them.',
    )
    // A change after saving is not saved yet.
    await user.type(form.getByRole('textbox', { name: 'Retire at' }), '0')
    expect(form.queryByRole('status')).toBeNull()
  })

  it('asks for a number it needs and sends nothing', async () => {
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'Retirement assumptions' }))
    await user.clear(form.getByRole('textbox', { name: 'Retire at' }))
    await user.click(form.getByRole('button', { name: 'Save assumptions' }))
    expect(form.getByRole('alert')).toHaveTextContent('Enter a retirement age.')
    expect(form.getByRole('textbox', { name: 'Retire at' })).toHaveAccessibleDescription(
      'The age you want to stop working',
    )
    expect(server.actions('update_settings')).toHaveLength(0)
  })
})

describe('the birth year', () => {
  it('is asked once under the projection, as a year only, and saved to settings', async () => {
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const ask = within(await card('What year were you born?'))
    expect(ask.getByText(/Only the year/)).toBeVisible()
    await user.type(ask.getByRole('textbox', { name: 'Year you were born' }), '1986')
    await user.click(ask.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    expect(server.actions('update_settings')[0]).toEqual({ retirement: { birthYear: 1986 } })
  })

  it('refuses anything but four digits, or a year out of range, and sends nothing', async () => {
    // Pinned to a day in 2026, so the years still to come stay the same.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
    const server = serve(retirementOf())
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const ask = within(await card('What year were you born?'))
    const field = ask.getByRole('textbox', { name: 'Year you were born' })
    const refusals: [string, string][] = [
      ['86', 'Enter the year as four digits, like 1986.'],
      ['May 4 1986', 'Enter the year as four digits, like 1986.'],
      ['2027', 'Use a birth year of 2026 or earlier, since 2027 is still to come.'],
      ['1915', 'Use a birth year of 1916 or later.'],
    ]
    for (const [typed, message] of refusals) {
      await user.clear(field)
      await user.type(field, typed)
      await user.click(ask.getByRole('button', { name: 'Save' }))
      expect(ask.getByRole('alert')).toHaveTextContent(message)
    }
    expect(server.actions('update_settings')).toHaveLength(0)
  })

  it('is asked again, with the year saved, when that year is still to come', async () => {
    const future = settingsWith({ retirement: { birthYear: 2090 } })
    const server = serve(retirementOf({}, { birthYear: 2090 }), settingsHandlers(future))
    renderPlanning('/wealth/retirement', future)
    const user = userEvent.setup()
    const ask = within(await card('What year were you born?'))
    expect(ask.getByText(/The year saved, 2090, is still to come\./)).toBeVisible()
    const field = ask.getByRole('textbox', { name: 'Year you were born' })
    expect(field).toHaveValue('2090')
    await user.click(ask.getByRole('button', { name: 'Save' }))
    expect(ask.getByRole('alert')).toHaveTextContent(/since 2090 is still to come/)
    await user.clear(field)
    await user.type(field, '1986')
    await user.click(ask.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ retirement: { birthYear: 1986 } }]),
    )
  })

  it('says why a save failed, under the year', async () => {
    serve(retirementOf(), {}, { '/api/actions/update_settings': failing('Database is down', 500) })
    renderPlanning('/wealth/retirement')
    const user = userEvent.setup()
    const ask = within(await card('What year were you born?'))
    await user.type(ask.getByRole('textbox', { name: 'Year you were born' }), '1986')
    await user.click(ask.getByRole('button', { name: 'Save' }))
    expect(await ask.findByRole('alert')).toHaveTextContent('Database is down')
  })

  it('is not asked once it is known', async () => {
    serve(withPension)
    renderPlanning('/wealth/retirement')
    await card('Retirement projection')
    expect(screen.queryByRole('region', { name: 'What year were you born?' })).toBeNull()
  })
})
