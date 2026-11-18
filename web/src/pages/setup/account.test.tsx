import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderPlain, status } from '../../test/fake'
import { Setup } from '../Setup'

afterEach(() => vi.unstubAllGlobals())

describe('creating the account', () => {
  /** Fills in the first step and sends it. */
  async function createAccount(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Setup code'), 'K7QM-2XRA-9PVD')
    await user.type(screen.getByLabelText('Name'), '  Dana Reyes  ')
    await user.type(screen.getByLabelText('Email'), 'dana@example.com')
    await user.type(screen.getByLabelText(/Password/), 'long enough password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('sends the name without the spaces around it', async () => {
    const server = fakeServer(
      {},
      { '/api/auth/setup': () => Response.json({ owner: { email: 'dana@example.com' } }) },
    )
    renderPlain(<Setup status={{ ...status, hasOwner: false }} />)
    await createAccount(userEvent.setup())
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/auth/setup')?.body).toEqual({
        email: 'dana@example.com',
        password: 'long enough password',
        name: 'Dana Reyes',
        setupCode: 'K7QM-2XRA-9PVD',
      }),
    )
  })

  it('says where to find the setup code', () => {
    fakeServer({})
    renderPlain(<Setup status={{ ...status, hasOwner: false }} />)
    expect(screen.getByLabelText('Setup code')).toHaveAccessibleDescription(
      /printed it in its server log/,
    )
  })

  it('says why the account could not be made, and lets the owner try again', async () => {
    fakeServer({}, { '/api/auth/setup': failing('This server already has an owner', 409) })
    renderPlain(<Setup status={{ ...status, hasOwner: false }} />)
    await createAccount(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent('This server already has an owner')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })
})
