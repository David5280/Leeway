import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmedDetailSchema } from '../../../../server/src/domain/paystubs/confirmed'
import { failing, fakeServer, renderSignedIn, settings, status } from '../../test/fake'
import {
  chosenFile,
  cityRead,
  paystubInUse,
  paystubStatus,
  reads,
  savedPaystub,
} from '../../test/paystub'
import { Setup } from '../Setup'

afterEach(() => vi.unstubAllGlobals())

/** A fresh install with no banks, able to read a paystub unless told otherwise. */
function serve(available = true, routes: Record<string, () => Response> = {}) {
  return fakeServer(
    {
      update_settings: (patch) => ({ ...settings, ...patch }),
      list_connections: () => [],
      get_starter_categories: () => [],
      get_paystub: () => paystubStatus(null, available),
      get_paystub_use: () => paystubInUse(),
      save_paystub_detail: (input) => {
        const detail = confirmedDetailSchema.parse(input.detail)
        return {
          paystub: savedPaystub(),
          detail: { ...detail, paystubId: savedPaystub().id, savedAt: '2026-11-19T16:00:00.000Z' },
        }
      },
    },
    { '/api/paystubs/read': reads(cityRead()), ...routes },
  )
}

/** Renders setup and walks from the period step past bank sync to the paystub step. */
async function toPaystubStep() {
  renderSignedIn(<Setup status={{ ...status, bank: null }} signedIn />)
  const user = userEvent.setup({ applyAccept: false })
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
  await screen.findByRole('heading', { name: 'Add a paystub' })
  return user
}

describe('the setup paystub step', () => {
  it('comes after bank sync as step 5 of 7, optional and doable later in Settings', async () => {
    serve()
    await toPaystubStep()
    expect(screen.getByText('Step 5 of 7')).toBeVisible()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Paystub')
    expect(screen.getByText(/^Optional\./)).toHaveTextContent(
      'You can do this any time in Settings, under Paystub.',
    )
    // Importing is the step's main button; skipping stays available but quiet.
    expect(await screen.findByRole('button', { name: 'Import a paystub' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Skip for now' })).not.toHaveClass('primary')
  })

  it('skips to the categories, saving nothing', async () => {
    const server = serve()
    const user = await toPaystubStep()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('heading', { name: 'Choose your categories' })).toBeVisible()
    expect(server.actions('save_paystub_detail')).toHaveLength(0)
  })

  it('imports and confirms a paystub, shows what Leeway now uses, then continues', async () => {
    const server = serve()
    const user = await toPaystubStep()
    await user.click(await screen.findByRole('button', { name: 'Import a paystub' }))
    await user.upload(screen.getByLabelText('Choose a paystub'), chosenFile())
    const form = within(await screen.findByRole('form', { name: 'Review your paystub' }))
    await user.click(form.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. Leeway now uses your paystub.',
    )
    expect(server.actions('save_paystub_detail')).toHaveLength(1)
    const used = within(
      await screen.findByRole('region', { name: 'What Leeway uses from your paystub' }),
    )
    expect(used.getByText('$92,280')).toHaveClass('review-key-value')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Choose your categories' })).toBeVisible()
  })

  it('returns to the step when the import is cancelled', async () => {
    serve()
    const user = await toPaystubStep()
    await user.click(await screen.findByRole('button', { name: 'Import a paystub' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  })

  it('without an AI key, says what to add and offers only the skip', async () => {
    serve(false)
    const user = await toPaystubStep()
    expect(await screen.findByText(/needs an Anthropic API key/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Import a paystub' })).toBeNull()
    // With nothing else to press, skipping is the main button.
    expect(screen.getByRole('button', { name: 'Skip for now' })).toHaveClass('primary')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('heading', { name: 'Choose your categories' })).toBeVisible()
  })

  it('still lets the owner skip when the server cannot say whether it reads paystubs', async () => {
    serve(true, { '/api/actions/get_paystub': failing('Something went wrong.', 500) })
    const user = await toPaystubStep()
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('heading', { name: 'Choose your categories' })).toBeVisible()
  })

  it('goes back to bank sync', async () => {
    serve()
    const user = await toPaystubStep()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Sync your bank' })).toBeVisible()
  })
})
