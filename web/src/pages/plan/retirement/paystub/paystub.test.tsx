import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEIC_HELP, MAX_PAYSTUB_BYTES } from '../../../../../../server/src/domain/paystubs/files'
import { savePaystubSchema } from '../../../../../../server/src/domain/paystubs/paystubs'
import { failing, settingsHandlers, type Handlers } from '../../../../test/fake'
import {
  chosenFile,
  cityRead,
  noPlansRead,
  paystubStatus,
  PENSION_ID,
  reads,
  savedPaystub,
} from '../../../../test/paystub'
import { planServer, renderPlan, retirementOf } from '../../../../test/planning'
import { pension } from '../../../../test/profile'

afterEach(() => vi.unstubAllGlobals())

const PERA = pension({ payCadence: 'biweek' }, { accountId: PENSION_ID })
const READ_ROUTE = '/api/paystubs/read'

/**
 * The Retirement section's server, able to read a paystub unless told
 * otherwise. save_paystub checks what it is sent with the server's own schema.
 */
function serve({
  pensions = [PERA],
  status = paystubStatus(),
  extra = {},
  read = reads(cityRead()),
}: {
  pensions?: (typeof PERA)[]
  status?: ReturnType<typeof paystubStatus>
  extra?: Handlers
  read?: () => Response
} = {}) {
  return planServer(
    {
      ...settingsHandlers(),
      project_retirement: () => retirementOf({ pensions }, { birthYear: 1986 }),
      list_accounts: () => [],
      update_pension: () => PERA,
      get_paystub: () => status,
      save_paystub: (input) => {
        const { paystub, pensionAccountId } = savePaystubSchema.parse(input)
        return { paystub: { ...savedPaystub(), ...paystub, pensionAccountId } }
      },
      delete_paystub: () => ({ deleted: true }),
      ...extra,
    },
    { [READ_ROUTE]: read },
  )
}

const card = () => screen.findByRole('region', { name: 'Paystub' })

/** Opens the import from the Paystub card and chooses a file. */
async function importFrom(file = chosenFile()) {
  const user = userEvent.setup({ applyAccept: false })
  renderPlan('/plan/retirement')
  await user.click(within(await card()).getByRole('button', { name: 'Import a paystub' }))
  await user.upload(await screen.findByLabelText('Choose a paystub'), file)
  return user
}

const review = () => screen.findByRole('form', { name: 'Review the paystub' })

describe('the Paystub card', () => {
  it('stays out of the way when the server cannot read a paystub', async () => {
    serve({ status: paystubStatus(null, false) })
    renderPlan('/plan/retirement')
    await screen.findByRole('region', { name: 'Pensions' })
    expect(screen.queryByRole('region', { name: 'Paystub' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import a paystub' })).toBeNull()
  })

  it('invites an import when no paystub is kept', async () => {
    serve()
    renderPlan('/plan/retirement')
    expect(within(await card()).getByText(/Import a paystub to fill in/)).toBeVisible()
  })

  it('shows the newest paystub to the cent, leaving out figures it did not show', async () => {
    const server = serve({ status: paystubStatus(savedPaystub()) })
    const user = userEvent.setup()
    renderPlan('/plan/retirement')
    const kept = within(await card())
    expect(kept.getByText('From City of Example, paid Nov 13, 2026')).toBeVisible()
    // Pay comes in, marked with a plus and its color; a contribution leaves pay, plain.
    expect(kept.getByText('Gross pay').nextSibling).toHaveTextContent('+$3,845.00')
    expect(kept.getByText('Gross pay').nextSibling).toHaveClass('money-in')
    expect(kept.getByText('457').nextSibling).toHaveTextContent(/^\$200\.00$/)
    expect(kept.getByText('457').nextSibling).toHaveClass('money-neutral')
    expect(kept.queryByText('HSA')).toBeNull()

    await user.click(kept.getByRole('button', { name: 'Delete this paystub' }))
    await waitFor(() =>
      expect(server.actions('delete_paystub')).toEqual([{ id: savedPaystub().id }]),
    )
  })

  it('names a paystub with no employer or pay date plainly', async () => {
    serve({ status: paystubStatus(savedPaystub({ employerName: null, payDate: null })) })
    renderPlan('/plan/retirement')
    expect(within(await card()).getByText('Your latest paystub')).toBeVisible()
  })

  it('says why a delete failed', async () => {
    serve({
      status: paystubStatus(savedPaystub()),
      extra: {
        delete_paystub: () => {
          throw new Error('unused')
        },
      },
    })
    const user = userEvent.setup()
    renderPlan('/plan/retirement')
    await user.click(within(await card()).getByRole('button', { name: 'Delete this paystub' }))
    expect(await within(await card()).findByRole('alert')).toBeVisible()
  })
})

describe('choosing a file', () => {
  it('says what is sent and kept, then sends only the file', async () => {
    const server = serve()
    const file = chosenFile()
    const user = userEvent.setup()
    renderPlan('/plan/retirement')
    await user.click(within(await card()).getByRole('button', { name: 'Import a paystub' }))
    const form = within(await screen.findByRole('region', { name: 'Import a paystub' }))
    // Plain that the file goes as it is: identifiers come out only of what Leeway keeps.
    expect(
      form.getByText(
        'The whole file goes to Anthropic as it is, including any Social Security number or address printed on it: first to check its length, then to be read once. Nothing else of yours goes with it.',
      ),
    ).toBeVisible()
    expect(form.getByText('Leeway never keeps the file, only the figures you save.')).toBeVisible()
    expect(
      form.getByText(
        'Leeway takes Social Security numbers, labeled IDs and long numbers out of what it shows and keeps.',
      ),
    ).toBeVisible()
    expect(form.queryByText(/Only the file is sent|are taken out\.$/)).toBeNull()
    // Plain that a long file is refused, not read at a cost.
    expect(
      form.getByText(
        'A paystub is a page or two. A longer file is turned away before it is read, so save just the pages with your pay figures.',
      ),
    ).toBeVisible()
    await user.upload(form.getByLabelText('Choose a paystub'), file)

    await review()
    const sent = server.calls.filter((call) => call.path === READ_ROUTE)
    expect(sent).toEqual([{ path: READ_ROUTE, body: file }])
    expect(server.actions('save_paystub')).toEqual([])
  })

  it('sends the file as it is, typed by the browser or as plain bytes', async () => {
    serve()
    await importFrom(chosenFile('', 2048, 'paystub'))
    await review()
    const [, init] = vi.mocked(fetch).mock.calls.find(([path]) => path === READ_ROUTE)!
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  })

  it('does nothing when the chooser is closed with no file', async () => {
    const server = serve()
    const user = userEvent.setup()
    renderPlan('/plan/retirement')
    await user.click(within(await card()).getByRole('button', { name: 'Import a paystub' }))
    fireEvent.change(screen.getByLabelText('Choose a paystub'), { target: { files: [] } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(server.calls.some((call) => call.path === READ_ROUTE)).toBe(false)
  })

  it('shows that Claude is reading while it reads', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ read: () => new Promise<Response>((resolve) => (answer = resolve)) as never })
    await importFrom()
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is reading your paystub')
    expect(screen.queryByLabelText('Choose a paystub')).toBeNull()
    answer(Response.json({ result: cityRead() }))
    await review()
  })

  it('explains a HEIC photo before sending anything', async () => {
    const server = serve()
    await importFrom(chosenFile('image/heic', 2048, 'IMG_0001.HEIC'))
    expect(await screen.findByRole('alert')).toHaveTextContent(HEIC_HELP)
    expect(server.calls.some((call) => call.path === READ_ROUTE)).toBe(false)
  })

  it('refuses a photo over its limit before sending it', async () => {
    const server = serve()
    await importFrom(chosenFile('image/jpeg', MAX_PAYSTUB_BYTES['image/jpeg'] + 1, 'p.jpg'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB/)
    expect(server.calls.some((call) => call.path === READ_ROUTE)).toBe(false)
  })

  it("shows the server's word when it will not read the file", async () => {
    serve({
      read: failing('Leeway has read 10 new files this hour. Try again in 12 minutes.', 429),
    })
    const user = await importFrom()
    expect(await screen.findByRole('alert')).toHaveTextContent(/10 new files this hour/)
    // Another file can be chosen at once, and the old message goes.
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile('image/heic'))
    expect(await screen.findByRole('alert')).toHaveTextContent(HEIC_HELP)
  })

  it('closes when cancelled', async () => {
    serve()
    const user = userEvent.setup()
    renderPlan('/plan/retirement')
    await user.click(within(await card()).getByRole('button', { name: 'Import a paystub' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Import a paystub' })).toBeNull()
  })
})

describe('the review screen', () => {
  it('shows each figure with how sure Claude was and the line it came from', async () => {
    serve()
    await importFrom()
    const form = within(await review())
    expect(form.getByText(/Nothing is saved until you choose Save/)).toBeVisible()

    const gross = form.getByRole('textbox', { name: 'This paycheck: Gross pay' })
    expect(gross).toHaveValue('3845.00')
    expect(gross).toHaveAccessibleDescription('From the line “Gross Pay 3,845.00”')
    expect(form.getByRole('textbox', { name: 'This paycheck: 457' })).toHaveValue('200.00')
    expect(form.getByRole('textbox', { name: 'Year to date: Gross pay' })).toHaveValue('80745.00')

    // The hard-to-read figure stands out; the others say how sure Claude was.
    const employer = form.getByText("Pension, employer's share").closest('.review-figure')!
    expect(within(employer as HTMLElement).getByText('Check closely')).toHaveClass('badge warn')
    expect(form.getAllByText('Read clearly').length).toBeGreaterThan(0)
    expect(form.getByText('Check this')).toHaveClass('badge')

    // Figures Claude did not find are folded away, ready to add.
    expect(form.getByText('Add a figure Claude did not find (3)')).toBeInTheDocument()
    expect(form.getByText('Add a figure Claude did not find (6)')).toBeInTheDocument()

    expect(form.getByLabelText('Employer')).toHaveValue('City of Example')
    expect(form.getByLabelText('Pay date')).toHaveValue('2026-11-13')
    expect(form.getByRole('combobox', { name: 'Paid' })).toHaveValue('semimonth')
    expect(form.getByText('From the line “Pay Frequency: Semi-Monthly”')).toBeVisible()
  })

  it('saves the figures as edited, to the pension and contribution chosen', async () => {
    const server = serve()
    const user = await importFrom()
    const form = within(await review())
    const gross = form.getByRole('textbox', { name: 'This paycheck: Gross pay' })
    await user.clear(gross)
    await user.type(gross, '3,900.00')
    await user.type(form.getByRole('textbox', { name: 'This paycheck: HSA' }), '75')
    await user.type(form.getByRole('textbox', { name: 'Year to date: HSA' }), '1,650')
    await user.selectOptions(form.getByRole('combobox', { name: 'Paid' }), 'biweek')
    await user.clear(form.getByLabelText('Employer'))
    await user.clear(form.getByLabelText('Period from'))
    await user.clear(form.getByLabelText('Period to'))
    await user.type(form.getByLabelText('Period to'), '2026-11-09')
    await user.clear(form.getByLabelText('Pay date'))
    await user.type(form.getByLabelText('Pay date'), '2026-11-14')
    await user.selectOptions(form.getByRole('combobox', { name: /Update a pension/ }), PENSION_ID)
    await user.click(form.getByRole('checkbox', { name: /what you add to retirement savings/ }))
    await user.click(form.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(server.actions('save_paystub')).toHaveLength(1))
    const [saved] = server.actions('save_paystub') as Record<string, never>[]
    expect(saved).toMatchObject({
      pensionAccountId: PENSION_ID,
      setRetirementContribution: true,
      paystub: {
        employerName: null,
        payDate: '2026-11-14',
        periodStart: null,
        periodEnd: '2026-11-09',
        payCadence: 'biweek',
        current: { grossPay: 390_000, hsa: 7_500, plan457: 20_000, pensionEmployer: 82_283 },
        yearToDate: { grossPay: 8_074_500, hsa: 165_000 },
      },
    })
    const done = within(await card())
    expect(await done.findByRole('status')).toHaveTextContent(
      'Saved the paystub paid Nov 14, 2026.',
    )
    expect(screen.queryByRole('form', { name: 'Review the paystub' })).toBeNull()
  })

  it('keeps every pension as it is unless one is chosen', async () => {
    const server = serve()
    const user = await importFrom()
    const form = within(await review())
    expect(form.getByRole('combobox', { name: /Update a pension/ })).toHaveValue('')
    await user.clear(form.getByLabelText('Pay date'))
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('save_paystub')).toEqual([
        expect.objectContaining({ pensionAccountId: null, setRetirementContribution: false }),
      ]),
    )
    expect(await within(await card()).findByRole('status')).toHaveTextContent('Saved the paystub.')
  })

  it('names a figure that is not an amount, and saves nothing', async () => {
    const server = serve()
    const user = await importFrom()
    const form = within(await review())
    const net = form.getByRole('textbox', { name: 'This paycheck: Take-home pay' })
    await user.clear(net)
    await user.type(net, 'unknown')
    await user.click(form.getByRole('button', { name: 'Save' }))
    expect(form.getByRole('alert')).toHaveTextContent(
      "Enter this paycheck's Take-home pay as an amount.",
    )
    expect(server.actions('save_paystub')).toEqual([])
  })

  it("shows the server's word when it will not save", async () => {
    serve({
      extra: {
        save_paystub: () => {
          throw new Error('unused')
        },
      },
    })
    const user = await importFrom()
    const form = within(await review())
    await user.click(form.getByRole('button', { name: 'Save' }))
    expect(await form.findByRole('alert')).toBeVisible()
    expect(form.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('offers no contribution when the paystub shows no 401(k), 457 or 403(b)', async () => {
    serve({ pensions: [], read: reads(noPlansRead) })
    await importFrom()
    const form = within(await review())
    expect(form.queryByRole('checkbox')).toBeNull()
    expect(form.queryByRole('combobox', { name: /Update a pension/ })).toBeNull()
    expect(form.getByText('Leeway keeps the figures with your paystubs.')).toBeVisible()
  })

  it('shows a figure it found with no amount, and no badge on a missing pay schedule', async () => {
    const read = cityRead({
      payFrequency: { value: null, confidence: 'low', source: null },
    })
    read.extraction.current.hsa = { cents: null, confidence: 'low', source: 'HSA see stub' }
    serve({ read: reads(read) })
    await importFrom()
    const form = within(await review())
    const hsa = form.getByRole('textbox', { name: 'This paycheck: HSA' })
    expect(hsa).toHaveValue('')
    expect(hsa).toHaveAccessibleDescription('From the line “HSA see stub”')
    expect(form.getByRole('combobox', { name: 'Paid' })).toHaveValue('')
    const paid = form.getByRole('combobox', { name: 'Paid' }).closest('.review-figure')!
    expect(within(paid as HTMLElement).queryByText(/Read clearly|Check/)).toBeNull()
  })

  it('goes back without saving when cancelled', async () => {
    const server = serve()
    const user = await importFrom()
    await user.click(within(await review()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Import a paystub' })).toBeNull()
    expect(server.actions('save_paystub')).toEqual([])
  })
})

describe('from a pension', () => {
  /** Opens a kept pension's form. */
  async function editPension() {
    const user = userEvent.setup({ applyAccept: false })
    renderPlan('/plan/retirement')
    const pensions = within(await screen.findByRole('region', { name: 'Pensions' }))
    await user.click(pensions.getByRole('button', { name: 'Edit figures' }))
    return user
  }

  it('offers an import that updates that pension', async () => {
    const server = serve()
    const user = await editPension()
    const editor = within(await screen.findByRole('region', { name: 'Colorado PERA' }))
    expect(editor.getByText('Have a paystub? Fill these figures from it.')).toBeVisible()
    await user.click(await editor.findByRole('button', { name: 'Import a paystub' }))

    const importing = within(
      await screen.findByRole('region', { name: 'Import a paystub for Colorado PERA' }),
    )
    await user.upload(importing.getByLabelText('Choose a paystub'), chosenFile())
    const form = within(await review())
    expect(form.getByRole('combobox', { name: /Update a pension/ })).toHaveValue(PENSION_ID)
    await user.click(form.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(server.actions('save_paystub')).toEqual([
        expect.objectContaining({ pensionAccountId: PENSION_ID }),
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Import a paystub for/ })).toBeNull(),
    )
  })

  it('goes back to the pension form when the import is cancelled', async () => {
    serve()
    const user = await editPension()
    const editor = within(await screen.findByRole('region', { name: 'Colorado PERA' }))
    await user.click(await editor.findByRole('button', { name: 'Import a paystub' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('region', { name: 'Colorado PERA' })).toBeVisible()
  })

  it('offers no import when the server cannot read a paystub, or for a new pension', async () => {
    serve({ status: paystubStatus(null, false) })
    const user = await editPension()
    await screen.findByRole('region', { name: 'Colorado PERA' })
    expect(screen.queryByText(/Have a paystub/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add a pension' }))
    await screen.findByRole('region', { name: 'Add a pension' })
    expect(screen.queryByText(/Have a paystub/)).toBeNull()
  })
})
