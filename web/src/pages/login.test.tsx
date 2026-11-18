import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { UNREACHABLE } from '../api/client'
import { failing, fakeServer, holdRequest, renderPlain, settings, status } from '../test/fake'
import { Login } from './Login'

afterEach(() => vi.unstubAllGlobals())

const owner = { email: 'owner@example.com', name: null, onboarded: false }
const signedIn = () => Response.json({ owner })
const signedOut = failing('Sign in', 401)

/** Fills in the sign-in form and sends it. */
async function signIn(user: ReturnType<typeof userEvent.setup>, password = 'correct horse') {
  await user.type(screen.getByLabelText('Email'), owner.email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('sign-in form', () => {
  it('asks for an email and a password, and says how to reset a forgotten one', () => {
    fakeServer({})
    renderPlain(<Login />)
    const form = screen.getByRole('form', { name: 'Sign in' })
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeRequired()
    expect(screen.getByLabelText('Password')).toBeRequired()
    expect(form).toHaveTextContent('npm run reset-password')
  })

  it('sends the email and password typed', async () => {
    const server = fakeServer({}, { '/api/auth/login': signedIn })
    renderPlain(<Login />)
    await signIn(userEvent.setup())
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({
        email: owner.email,
        password: 'correct horse',
      }),
    )
  })

  it('shows that it is signing in and blocks a second try until the server answers', async () => {
    fakeServer({}, { '/api/auth/login': signedIn })
    const release = holdRequest('/api/auth/login')
    renderPlain(<Login />)
    await signIn(userEvent.setup())
    expect(screen.getByRole('button', { name: 'Signing in' })).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('says why sign-in failed, and clears the reason on the next try', async () => {
    let reply = failing('Wrong email or password', 401)
    fakeServer({}, { '/api/auth/login': () => reply() })
    renderPlain(<Login />)
    const user = userEvent.setup()
    await signIn(user, 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()

    reply = signedIn
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('signing in to the app', () => {
  /**
   * A server whose session begins once sign-in succeeds. Saving settings ends
   * it, as an expired session would, so a test can sign out mid-use.
   */
  function serveSignedOut(startSignedIn = false) {
    let session = startSignedIn
    return fakeServer(
      { get_settings: () => settings },
      {
        '/api/status': () => Response.json(status),
        '/api/auth/me': () => (session ? signedIn() : signedOut()),
        '/api/auth/login': () => {
          session = true
          return signedIn()
        },
        '/api/actions/update_settings': () => {
          session = false
          return signedOut()
        },
      },
    )
  }

  it('opens the app once the owner signs in', async () => {
    serveSignedOut()
    renderPlain(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Welcome back' })
    await signIn(user)
    // This owner has not finished setup, so the app picks up at the second step.
    expect(await screen.findByRole('heading', { name: 'How do you budget?' })).toBeInTheDocument()
  })

  it('waits for settings before showing the app', async () => {
    serveSignedOut()
    const release = holdRequest('/api/actions/get_settings')
    renderPlain(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    await signIn(userEvent.setup())
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    release()
    expect(await screen.findByRole('heading', { name: 'How do you budget?' })).toBeInTheDocument()
  })

  it('goes back to sign-in when the session ends while the app is open', async () => {
    serveSignedOut(true)
    renderPlain(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'How do you budget?' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('says the server is not answering when it cannot be reached', async () => {
    fakeServer({}, { '/api/status': failing('Bad gateway', 502) })
    renderPlain(<App />)
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument()
  })
})
