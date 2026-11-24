import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmedDetailSchema } from '../../../../server/src/domain/paystubs/confirmed'
import { fakeServer, renderSignedIn, settingsHandlers } from '../../test/fake'
import {
  chosenFile,
  cityRead,
  NO_PAYSTUB_IN_USE,
  paystubInUse,
  paystubStatus,
  reads,
  savedPaystub,
  THIS_YEAR,
} from '../../test/paystub'
import { PaystubSection } from './Paystub'

afterEach(() => vi.unstubAllGlobals())

/** A server with paystub import as given; it reads the city paystub and saves what is confirmed. */
function serve({ available = true, use = NO_PAYSTUB_IN_USE, saved = paystubInUse() } = {}) {
  let inUse = use
  return fakeServer(
    {
      ...settingsHandlers(),
      get_paystub: () => paystubStatus(null, available),
      get_paystub_use: () => inUse,
      save_paystub_detail: (input) => {
        const detail = confirmedDetailSchema.parse(input.detail)
        inUse = saved
        return {
          paystub: savedPaystub(),
          detail: { ...detail, paystubId: savedPaystub().id, savedAt: '2026-11-19T16:00:00.000Z' },
        }
      },
    },
    { '/api/paystubs/read': reads(cityRead()) },
  )
}

const figures = () =>
  within(screen.getByRole('region', { name: 'What Leeway uses from your paystub' }))

describe('Settings, Paystub', () => {
  it('starts empty, offering the import as the main button', async () => {
    serve()
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/No paystub yet/)).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Import a paystub' })).toHaveClass('primary')
  })

  it('imports, reviews and confirms a paystub, then shows what Leeway uses', async () => {
    const server = serve()
    renderSignedIn(<PaystubSection />)
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole('button', { name: 'Import a paystub' }))
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile())
    const form = within(await screen.findByRole('form', { name: 'Review your paystub' }))
    await user.click(form.getByRole('button', { name: 'Confirm' }))

    // Named as in use once the refetch after saving says it is.
    expect(await screen.findByText('Saved. Leeway now uses your paystub.')).toHaveAttribute(
      'role',
      'status',
    )
    expect(server.actions('save_paystub_detail')).toHaveLength(1)
    expect(await figures().findByText('$92,280')).toHaveClass('review-key-value')
    // Once in use, importing again is a quiet way to redo it.
    expect(screen.getByRole('button', { name: 'Import a paystub' })).not.toHaveClass('primary')
  })

  it('lets the import be cancelled, leaving things as they were', async () => {
    serve()
    renderSignedIn(<PaystubSection />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Import a paystub' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText(/No paystub yet/)).toBeVisible()
  })

  it('shows the figures in use in bold: pay, take-home, retirement and taxes', async () => {
    serve({ use: paystubInUse() })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText('Nov 13, 2026')).toBeVisible()
    expect(figures().getByText('$92,280')).toHaveClass('review-key-value')
    expect(figures().getByText('$2,611.42')).toHaveClass('review-key-value')
    expect(figures().getByText('Used for your paychecks')).toBeVisible()
    expect(figures().getByText('37.6%')).toHaveClass('review-key-value')
    expect(figures().getByText('14.6%')).toHaveClass('review-key-value')
    expect(screen.getByText(/Your employer adds/)).toHaveTextContent(
      'Your employer adds $125 a month to your retirement.',
    )
    expect(screen.getByText(/Income tax withheld/)).toHaveTextContent(
      'Income tax withheld so far this year: federal $7,350 and state $3,147.',
    )
    expect(screen.queryByText(/still follows your bank/)).toBeNull()
    // Nothing that names who paid.
    expect(document.body).not.toHaveTextContent('City of Example')
    expect(document.querySelector('.over, .notice.error')).toBeNull()
  })

  it("names last year's withholding by its year", async () => {
    const used = paystubInUse()
    used.figures!.taxes.year = THIS_YEAR - 1
    serve({ use: used })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/Income tax withheld/)).toHaveTextContent(
      `Income tax withheld in ${THIS_YEAR - 1}: federal`,
    )
  })

  it.each([
    ['noMatch', /Your pay still follows your bank deposits, since none matches this take-home/],
    ['ownPay', /Your pay follows the pay you entered yourself/],
    ['oneOff', /This paycheck included a bonus or commission/],
    ['noSchedule', /The paystub shows no pay date or how often you are paid/],
  ] as const)('says plainly why the take-home is not used for pay: %s', async (reason, words) => {
    serve({ use: paystubInUse({ appliedToPay: false, notForPay: reason }) })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText('Not used for pay')).toBeVisible()
    expect(screen.getByText(words)).toBeVisible()
    // Only the one reason shows, and the other figures still count.
    expect(screen.getAllByText(/follows|included a bonus/)).toHaveLength(1)
    expect(figures().getByText('$92,280')).toBeVisible()
  })

  it('says only "Saved." when the paystub just confirmed is too old to use', async () => {
    const stale = { ...NO_PAYSTUB_IN_USE, state: 'stale' as const, paidOn: '2026-04-10' }
    serve({ saved: stale })
    renderSignedIn(<PaystubSection />)
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole('button', { name: 'Import a paystub' }))
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile())
    const form = within(await screen.findByRole('form', { name: 'Review your paystub' }))
    await user.click(form.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/over six months old/)).toBeVisible()
    expect(screen.getByText('Saved.')).toHaveAttribute('role', 'status')
  })

  it('says a paystub over six months old is no longer used, and offers a new one', async () => {
    serve({
      use: { ...NO_PAYSTUB_IN_USE, state: 'stale', paidOn: '2026-04-10', takeHomeCents: 261_142 },
    })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/over six months old/)).toHaveTextContent(
      'Your latest paystub, paid Apr 10, 2026, is over six months old, so Leeway no longer uses it.',
    )
    expect(screen.queryByRole('region', { name: 'What Leeway uses from your paystub' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Import a paystub' })).toHaveClass('primary')
  })

  it('says a paystub saved for a pension only is used only for that', async () => {
    serve({
      use: { ...NO_PAYSTUB_IN_USE, state: 'partial', paidOn: '2026-11-14', retirementInUse: true },
    })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/saved for your pension only/)).toHaveTextContent(
      'so Leeway uses just its retirement figures.',
    )
  })

  it('claims no retirement figures for a partial paystub that shows no pension or plan', async () => {
    serve({ use: { ...NO_PAYSTUB_IN_USE, state: 'partial', paidOn: '2026-11-14' } })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/saved for your pension only/)).toHaveTextContent(
      'so Leeway does not use its figures yet.',
    )
  })

  it('without an AI key, says what to add instead of offering an import that cannot run', async () => {
    serve({ available: false })
    renderSignedIn(<PaystubSection />)
    expect(await screen.findByText(/Reading a paystub needs an Anthropic API key/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Import a paystub' })).toBeNull()
  })

  it('without an AI key, still shows the figures already in use', async () => {
    serve({ available: false, use: paystubInUse() })
    renderSignedIn(<PaystubSection />)
    await waitFor(() => expect(figures().getByText('$92,280')).toBeVisible())
    expect(screen.getByText(/needs an Anthropic API key/)).toBeVisible()
  })
})
