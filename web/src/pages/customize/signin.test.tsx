// The Sign-in section: changing the password and signing out.

import { useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auth } from '../../api/client'
import { failing, fakeServer, renderSignedIn, settingsHandlers } from '../../test/fake'
import { SignInSection } from './SignIn'

afterEach(() => vi.unstubAllGlobals())

describe('Sign-in', () => {
  function form() {
    return screen.getByRole('form', { name: 'Change password' })
  }

  async function fillAndSubmit(current: string, next: string) {
    const user = userEvent.setup()
    await user.type(within(form()).getByLabelText('Current password'), current)
    await user.type(within(form()).getByLabelText('New password'), next)
    await user.click(within(form()).getByRole('button', { name: 'Change password' }))
  }

  it('changes the password, clears the fields and says other devices are out', async () => {
    const server = fakeServer(
      {},
      { '/api/auth/password': () => new Response(null, { status: 204 }) },
    )
    renderSignedIn(<SignInSection />)
    await fillAndSubmit('old password 1', 'a much longer password')
    expect(await screen.findByText(/Password changed/)).toHaveTextContent(
      'Other devices are signed out.',
    )
    expect(server.calls.find((c) => c.path === '/api/auth/password')?.body).toEqual({
      currentPassword: 'old password 1',
      newPassword: 'a much longer password',
    })
    expect(within(form()).getByLabelText('Current password')).toHaveValue('')
    expect(within(form()).getByLabelText('New password')).toHaveValue('')
  })

  it('shows why the password was not changed and keeps what was typed', async () => {
    fakeServer(
      {},
      {
        '/api/auth/password': () =>
          Response.json(
            { error: 'unauthorized', message: 'Your current password is not right' },
            { status: 401 },
          ),
      },
    )
    renderSignedIn(<SignInSection />)
    await fillAndSubmit('wrong password', 'a much longer password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is not right')
    expect(screen.queryByText(/Password changed/)).not.toBeInTheDocument()
    expect(within(form()).getByLabelText('Current password')).toHaveValue('wrong password')
  })

  it('asks the browser to hold back a new password shorter than 10 characters', () => {
    fakeServer({})
    renderSignedIn(<SignInSection />)
    // jsdom does not check minlength on submit, so check the rule the browser enforces.
    const next = within(form()).getByLabelText('New password')
    expect(next).toHaveAttribute('minlength', '10')
    expect(next).toBeRequired()
    expect(next).toHaveAttribute('type', 'password')
  })

  it('needs the current password before sending', async () => {
    const server = fakeServer({})
    renderSignedIn(<SignInSection />)
    const user = userEvent.setup()
    await user.type(within(form()).getByLabelText('New password'), 'a much longer password')
    await user.click(within(form()).getByRole('button', { name: 'Change password' }))
    expect(server.calls).toEqual([])
  })

  it('signs out, forgets everything cached and asks again who is signed in', async () => {
    let session = true
    const server = fakeServer(settingsHandlers(), {
      '/api/auth/logout': () => {
        session = false
        return new Response(null, { status: 204 })
      },
      '/api/auth/me': () =>
        session ? Response.json({ owner: { email: 'a@b.c' } }) : failing('Sign in', 401)(),
    })
    // Stands in for the app, which shows sign-in once this query fails.
    function WhoIsSignedIn() {
      const me = useQuery({ queryKey: ['me'], queryFn: auth.me })
      if (me.isError) return <p>Signed out</p>
      return <p>{me.isSuccess ? 'Signed in' : 'Checking'}</p>
    }
    const { client } = renderSignedIn(
      <>
        <SignInSection />
        <WhoIsSignedIn />
      </>,
    )
    expect(await screen.findByText('Signed in')).toBeInTheDocument()
    client.setQueryData(['action', 'list_accounts', { includeHidden: true }], [])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(server.calls.map((c) => c.path)).toContain('/api/auth/logout'))
    await waitFor(() =>
      expect(
        client.getQueryData(['action', 'list_accounts', { includeHidden: true }]),
      ).toBeUndefined(),
    )
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
  })

  it('shows why signing out failed', async () => {
    fakeServer({}, { '/api/auth/logout': failing('Server unavailable', 503) })
    renderSignedIn(<SignInSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
  })
})
