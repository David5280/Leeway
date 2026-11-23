import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmedDetailSchema } from '../../../../server/src/domain/paystubs/confirmed'
import { failing, fakeServer, renderSignedIn, settingsHandlers } from '../../test/fake'
import {
  chosenFile,
  cityRead,
  noPensionRead,
  reads,
  savedPaystub,
  unreadableOtherRead,
} from '../../test/paystub'
import { FullPaystubImport } from './FullPaystubImport'

afterEach(() => vi.unstubAllGlobals())

const READ_ROUTE = '/api/paystubs/read'

/** A server that reads the city paystub, and saves what it is sent, checked by the server's schema. */
function serve({
  read = reads(cityRead()),
  save,
}: { read?: () => Response; save?: () => Response } = {}) {
  return fakeServer(
    {
      ...settingsHandlers(),
      save_paystub_detail: (input) => {
        const detail = confirmedDetailSchema.parse(input.detail)
        return {
          paystub: savedPaystub(),
          detail: { ...detail, paystubId: savedPaystub().id, savedAt: '2026-11-19T16:00:00.000Z' },
        }
      },
    },
    { [READ_ROUTE]: read, ...(save ? { '/api/actions/save_paystub_detail': save } : {}) },
  )
}

/** Opens the full import and chooses a file; returns the callbacks it was given. */
async function chooseFile() {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const user = userEvent.setup({ applyAccept: false })
  renderSignedIn(<FullPaystubImport readerName="Claude" onSaved={onSaved} onCancel={onCancel} />)
  expect(screen.getByText(/Claude reads every line on it: pay, taxes, deductions/)).toBeVisible()
  await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile())
  const form = within(await screen.findByRole('form', { name: 'Review your paystub' }))
  return { user, form, onSaved, onCancel }
}

describe('the full paystub review', () => {
  it('leads with what the paystub adds up to, in bold, saying what each rests on', async () => {
    serve()
    const { form } = await chooseFile()
    const keys = within(form.getByRole('region', { name: 'What this paystub adds up to' }))
    // 3,845.00 x 24 paychecks.
    expect(keys.getByText('$92,280')).toHaveClass('review-key-value')
    expect(keys.getByText('This paycheck, paid twice a month')).toBeVisible()
    // 2,611.42 of 3,845.00.
    expect(keys.getByText('67.9%')).toBeVisible()
    // 560.63 withheld of 3,845.00: the Denver tax prints only this paycheck, so the year is not used.
    expect(keys.getByText('14.6%')).toBeVisible()
    expect(keys.getByText('Withheld, from this paycheck')).toBeVisible()
    // 422.95 + 150.00 + 50.00 + 822.83 of 3,845.00.
    expect(keys.getByText('37.6%')).toBeVisible()
  })

  it('groups every line under Pay, Taxes, Deductions and savings, and Employer contributions', async () => {
    serve()
    const { form } = await chooseFile()
    for (const legend of ['Pay', 'Taxes', 'Deductions and savings', 'Employer contributions']) {
      expect(form.getByRole('group', { name: legend })).toBeVisible()
    }
    const gross = form.getByRole('textbox', { name: 'Pay: Gross pay, this paycheck' })
    expect(gross).toHaveValue('3845.00')
    expect(gross).toHaveAccessibleDescription('From the line “Gross Pay 3,845.00”')
    expect(form.getByText('Gross pay')).toHaveClass('strong')
    expect(form.getByRole('textbox', { name: 'Pay: Gross pay, year to date' })).toHaveValue(
      '80745.00',
    )
    expect(form.getByRole('textbox', { name: 'Taxes: Medicare, year to date' })).toHaveValue(
      '1170.75',
    )
    expect(form.getByRole('textbox', { name: 'After tax: Roth 457, this paycheck' })).toHaveValue(
      '50.00',
    )
    // The same name reads apart by the heading it sits under.
    expect(
      form.getByRole('textbox', { name: 'Employer contributions: Pension, this paycheck' }),
    ).toHaveValue('822.83')
    expect(form.getByRole('textbox', { name: 'Before tax: Pension, this paycheck' })).toHaveValue(
      '422.95',
    )
    expect(form.getByLabelText('Yearly salary')).toHaveValue('92280.00')
  })

  it('marks only the figures worth a second look, and folds away lines Claude missed', async () => {
    serve()
    const { form } = await chooseFile()
    const employer = form.getByRole('group', { name: 'Employer contributions' })
    expect(within(employer).getByText('Check closely')).toHaveClass('badge warn')
    expect(form.getByText('Check this')).toHaveClass('badge')
    expect(within(form.getByRole('group', { name: 'Pay' })).queryByText('Read clearly')).toBeNull()
    // Taxes shows four lines; Social Security and other taxes wait, folded.
    const taxes = within(form.getByRole('group', { name: 'Taxes' }))
    expect(taxes.getByText('Add a line Claude did not find (2)')).toBeInTheDocument()
    expect(
      form.getByRole('textbox', { name: 'Taxes: Social Security, this paycheck' }),
    ).not.toBeVisible()
  })

  it('names the reader as the server does, in the lines it found and missed', async () => {
    serve({ read: reads({ ...noPensionRead, readerName: 'Acme Reader' }) })
    const { form } = await chooseFile()
    const taxes = within(form.getByRole('group', { name: 'Taxes' }))
    expect(taxes.getByText('Add a line Acme Reader did not find (2)')).toBeInTheDocument()
    const employer = within(form.getByRole('group', { name: 'Employer contributions' }))
    expect(employer.getByText('Acme Reader found none of these.')).toBeVisible()
  })

  it('keeps an unreadable line in view with its flag, though its source is never shown', async () => {
    serve({ read: reads(unreadableOtherRead) })
    const { form } = await chooseFile()
    const other = form.getByRole('textbox', { name: 'After tax: Other, after tax, this paycheck' })
    expect(other).toBeVisible()
    expect(other).toHaveValue('')
    expect(other).not.toHaveAccessibleDescription()
    expect(within(other.closest('.review-line')!).getByText('Check closely')).toBeVisible()
  })

  it('takes hours and an hourly rate for hourly pay', async () => {
    const server = serve()
    const { user, form } = await chooseFile()
    await user.type(form.getByLabelText('Hours'), '80')
    await user.type(form.getByLabelText('Hourly rate'), '48.06')
    await user.click(form.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(server.actions('save_paystub_detail')).toHaveLength(1))
    const [sent] = server.actions('save_paystub_detail') as [{ detail: Record<string, unknown> }]
    expect(sent.detail).toMatchObject({ pay: { hours: 80, hourlyRate: 4_806 } })
  })

  it('folds hours and an hourly rate away when the paystub shows none of them', async () => {
    const salaried = cityRead()
    salaried.extraction.detail.pay.annualSalary = { value: null, confidence: 'high', source: null }
    serve({ read: reads(salaried) })
    const { form } = await chooseFile()
    expect(form.getByText('Add hours, an hourly rate or a salary')).toBeInTheDocument()
    expect(form.getByLabelText('Hours')).not.toBeVisible()
  })

  it('updates the key figures as a line is fixed', async () => {
    serve()
    const { user, form } = await chooseFile()
    const gross = form.getByRole('textbox', { name: 'Pay: Gross pay, this paycheck' })
    await user.clear(gross)
    await user.type(gross, '4000')
    // 4,000.00 x 24.
    expect(form.getByText('$96,000')).toBeVisible()
  })

  it('works yearly pay out from the year so far, or the stated salary, without a pay schedule', async () => {
    const unscheduled = cityRead({ payFrequency: { value: null, confidence: 'low', source: null } })
    serve({ read: reads(unscheduled) })
    const { user, form } = await chooseFile()
    const keys = within(form.getByRole('region', { name: 'What this paystub adds up to' }))
    // 80,745.00 by 13 November, day 317 of 365, is about 92,971 for the year.
    expect(keys.getByText('$92,971')).toBeVisible()
    expect(keys.getByText('The year so far, for a full year')).toBeVisible()
    await user.clear(form.getByRole('textbox', { name: 'Pay: Gross pay, year to date' }))
    expect(keys.getByText('$92,280')).toBeVisible()
    expect(keys.getByText('Your stated salary')).toBeVisible()
  })

  it('leaves a bonus out of yearly pay, and names only who saves for retirement', async () => {
    const bonus = cityRead()
    const { detail } = bonus.extraction
    const none = { current: null, yearToDate: null, confidence: 'high' as const, source: null }
    detail.pay.gross = { ...detail.pay.gross, current: 1_384_500 }
    detail.earnings.bonus = { ...none, current: 1_000_000 }
    detail.pay.annualSalary = { value: null, confidence: 'high', source: null }
    detail.employer.pension = none
    serve({ read: reads(bonus) })
    const { form } = await chooseFile()
    const keys = within(form.getByRole('region', { name: 'What this paystub adds up to' }))
    // 13,845.00 less the 10,000.00 bonus, x 24.
    expect(keys.getByText('$92,280')).toBeVisible()
    expect(keys.getByText('This paycheck less one-off pay, paid twice a month')).toBeVisible()
    expect(keys.getByText('You, from this paycheck')).toBeVisible()
  })

  it('says a key figure is not shown when the paystub gives nothing to work it out', async () => {
    const bare = cityRead({ payFrequency: { value: null, confidence: 'low', source: null } })
    bare.extraction.detail.pay.gross = {
      current: null,
      yearToDate: null,
      confidence: 'high',
      source: null,
    }
    bare.extraction.detail.pay.annualSalary = { value: null, confidence: 'high', source: null }
    bare.extraction.detail.employer.pension = {
      current: null,
      yearToDate: null,
      confidence: 'high',
      source: null,
    }
    serve({ read: reads(bare) })
    const { form } = await chooseFile()
    const keys = within(form.getByRole('region', { name: 'What this paystub adds up to' }))
    expect(keys.getAllByText('Not shown')).toHaveLength(4)
    expect(keys.getByText('Before tax')).toBeVisible()
    const employer = within(form.getByRole('group', { name: 'Employer contributions' }))
    expect(employer.getByText('Claude found none of these.')).toBeVisible()
  })

  it('saves the figures as edited, with nothing applied anywhere else', async () => {
    const server = serve()
    const { user, form, onSaved } = await chooseFile()
    await user.type(
      form.getByRole('textbox', { name: 'Taxes: Social Security, this paycheck' }),
      '238.39',
    )
    await user.type(
      form.getByRole('textbox', { name: 'Taxes: Social Security, year to date' }),
      '5006.19',
    )
    // A double click saves once.
    await user.dblClick(form.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(server.actions('save_paystub_detail')).toHaveLength(1)
    const [sent] = server.actions('save_paystub_detail') as [{ detail: Record<string, unknown> }]
    expect(sent.detail).toMatchObject({
      employerName: 'City of Example',
      payCadence: 'semimonth',
      taxes: { socialSecurity: { current: 23_839, yearToDate: 500_619 } },
      postTax: { roth457: { current: 5_000, yearToDate: null } },
    })
    expect(server.actions('save_paystub')).toEqual([])
  })

  it('says what to fix before sending, and shows a refusal from the server', async () => {
    const server = serve({ save: failing('Use $1,000,000 or less') })
    const { user, form, onSaved } = await chooseFile()
    const net = form.getByRole('textbox', { name: 'Pay: Take-home pay, this paycheck' })
    await user.clear(net)
    await user.type(net, '3900')
    await user.click(form.getByRole('button', { name: 'Confirm' }))
    expect(form.getByRole('alert')).toHaveTextContent('Take-home pay cannot be more than gross pay')
    expect(server.actions('save_paystub_detail')).toEqual([])

    await user.clear(net)
    await user.type(net, '2611.42')
    await user.click(form.getByRole('button', { name: 'Confirm' }))
    expect(await form.findByText('Use $1,000,000 or less')).toBeVisible()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('edits who paid and when, and goes back without saving when cancelled', async () => {
    const server = serve()
    const { user, form, onCancel } = await chooseFile()
    const employer = form.getByLabelText('Employer')
    await user.clear(employer)
    await user.type(employer, 'Acme')
    await user.selectOptions(form.getByRole('combobox', { name: 'Paid' }), 'biweek')
    expect(form.getByText('This paycheck, paid every 2 weeks')).toBeVisible()
    await user.click(form.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(server.actions('save_paystub_detail')).toEqual([])
  })

  it('turns a file away before sending it, and shows a failed read', async () => {
    serve({ read: failing('Claude is busy right now. Try again in a minute.', 503) })
    const user = userEvent.setup({ applyAccept: false })
    renderSignedIn(<FullPaystubImport readerName="Claude" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile('application/pdf', 0))
    expect(screen.getByRole('alert')).toHaveTextContent('The file is empty.')
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile())
    expect(
      await screen.findByText('Claude is busy right now. Try again in a minute.'),
    ).toBeVisible()
  })
})
