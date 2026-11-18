// The first two setup steps: the setup code, then the owner's sign-in.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNREACHABLE, type Status } from '../../api/client'
import { failing, fakeServer, renderPlain, status } from '../../test/fake'
import { Setup } from '../Setup'
import { passwordHint } from './AccountStep'
import { codeSteps } from './WhereIsTheCode'

afterEach(() => vi.unstubAllGlobals())

const fresh: Status = { ...status, hasOwner: false, onboarded: false, setupCodeFrom: 'variable' }
const accepted = () => new Response(null, { status: 204 })
const created = () => Response.json({ owner: { email: 'dana@example.com' } })

/** The routes a fresh server answers, with the code check and setup as given. */
function serve(routes: Record<string, () => Response> = {}) {
  return fakeServer({}, { '/api/auth/setup-code': accepted, '/api/auth/setup': created, ...routes })
}

/** Types the code and moves on to the sign-in step. */
async function enterCode(user: ReturnType<typeof userEvent.setup>, code = 'K7QM-2XRA-9PVD') {
  await user.type(screen.getByLabelText('Setup code'), code)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

/** Fills in the sign-in step and sends it. */
async function createAccount(
  user: ReturnType<typeof userEvent.setup>,
  password = 'long enough password',
) {
  await user.type(await screen.findByLabelText('Your name (optional)'), '  Dana Reyes  ')
  await user.type(screen.getByLabelText('Email'), 'dana@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Create my account' }))
}

/** The text of the steps for one case, one string per step. */
function stepsText(platform: Status['platform'], from: 'variable' | 'log'): string[] {
  render(
    <ol>
      {codeSteps(platform, from).map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>,
  )
  const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
  document.body.innerHTML = ''
  return items
}

describe('the setup code step', () => {
  it('asks only for the code, and says what it is for', () => {
    serve()
    renderPlain(<Setup status={fresh} />)
    expect(screen.getByRole('heading', { name: 'Enter your setup code' })).toBeInTheDocument()
    expect(screen.getByText(/proves it is yours/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Setup code')
  })

  it('says where the code is, tied to the field for screen readers', () => {
    serve()
    renderPlain(<Setup status={fresh} />)
    expect(screen.getByLabelText('Setup code')).toHaveAccessibleDescription(
      /Where to find it.*Variables.*SETUP_CODE/,
    )
  })

  it('points to the log when the server made the code up, and warns it changes on restart', () => {
    serve()
    renderPlain(<Setup status={{ ...fresh, platform: 'docker', setupCodeFrom: 'log' }} />)
    expect(screen.getByText('docker compose logs leeway')).toBeInTheDocument()
    expect(screen.getByText(/new code each time it restarts/)).toBeInTheDocument()
  })

  it('falls back to the log when the server does not say where the code came from', () => {
    serve()
    renderPlain(<Setup status={{ ...fresh, setupCodeFrom: null }} />)
    expect(screen.getByText(/latest deployment/)).toBeInTheDocument()
  })

  it('gives steps for every platform and source', () => {
    expect(stepsText('railway', 'variable')).toEqual([
      'Open your project at railway.com and click the Leeway service.',
      'Open the Variables tab.',
      'Copy the value of SETUP_CODE.',
    ])
    expect(stepsText('railway', 'log')).toEqual([
      'Open your project at railway.com and click the Leeway service.',
      'Click its latest deployment, then open Deploy Logs.',
      'Find the line that starts No account yet. The code is at the end of it.',
    ])
    expect(stepsText('docker', 'variable')).toEqual([
      'Open the .env file in your Leeway folder.',
      'Copy the value of SETUP_CODE.',
    ])
    expect(stepsText('docker', 'log')[0]).toBe(
      'In a terminal, in your Leeway folder, run docker compose logs leeway.',
    )
    expect(stepsText('other', 'variable')[0]).toMatch(/your \.env file or the server's environment/)
    expect(stepsText('other', 'log')).toEqual([
      'Open the terminal or log where Leeway is running.',
      'Find the line that starts No account yet. The code is at the end of it.',
    ])
  })

  it('checks the code before asking for anything else', async () => {
    const server = serve()
    renderPlain(<Setup status={fresh} />)
    await enterCode(userEvent.setup())
    expect(await screen.findByRole('heading', { name: 'Create your sign-in' })).toBeInTheDocument()
    expect(server.calls.find((c) => c.path === '/api/auth/setup-code')?.body).toEqual({
      setupCode: 'K7QM-2XRA-9PVD',
    })
  })

  it('stays on the code with the reason when the code is wrong', async () => {
    serve({
      '/api/auth/setup-code': failing(
        "That setup code is not right. Copy it again from SETUP_CODE in Leeway's settings.",
        403,
      ),
    })
    renderPlain(<Setup status={fresh} />)
    await enterCode(userEvent.setup(), 'WRNG-CODE-HERE')
    expect(await screen.findByRole('alert')).toHaveTextContent('That setup code is not right.')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('says plainly when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderPlain(<Setup status={fresh} />)
    await enterCode(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREACHABLE)
  })

  it('says the same when a proxy answers for a server that is down', async () => {
    serve({ '/api/auth/setup-code': () => new Response('Bad gateway', { status: 502 }) })
    renderPlain(<Setup status={fresh} />)
    await enterCode(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREACHABLE)
  })
})

describe('the sign-in step', () => {
  it('sends the name without the spaces around it, with the checked code', async () => {
    const server = serve()
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    await createAccount(user)
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/auth/setup')?.body).toEqual({
        email: 'dana@example.com',
        password: 'long enough password',
        name: 'Dana Reyes',
        setupCode: 'K7QM-2XRA-9PVD',
      }),
    )
  })

  it('goes back to the code with the code still typed', async () => {
    serve()
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Setup code')).toHaveValue('K7QM-2XRA-9PVD')
  })

  it('counts down to a long enough password as it is typed', async () => {
    serve()
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    const password = await screen.findByLabelText('Password')
    expect(password).toHaveAccessibleDescription(/At least 10 characters/)
    await user.type(password, 'short')
    expect(password).toHaveAccessibleDescription('5 more characters to go.')
  })

  it('refuses a short password in a sentence, without asking the server', async () => {
    const server = serve()
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    await createAccount(user, 'short')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a password of at least 10 characters.',
    )
    expect(server.calls.find((c) => c.path === '/api/auth/setup')).toBeUndefined()
  })

  it('says why the account could not be made, and lets the owner try again', async () => {
    serve({ '/api/auth/setup': failing('This Leeway already has an owner; sign in instead', 409) })
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    await createAccount(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('This Leeway already has an owner')
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeEnabled()
  })

  it('goes back to the code with the reason when the code stopped working', async () => {
    // A code from the log changes when Leeway restarts, even between the two steps.
    serve({ '/api/auth/setup': failing('That setup code is not right.', 403) })
    renderPlain(<Setup status={fresh} />)
    const user = userEvent.setup()
    await enterCode(user)
    await createAccount(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('That setup code is not right.')
    expect(screen.getByRole('heading', { name: 'Enter your setup code' })).toBeInTheDocument()
    // Typing a new code clears the old reason.
    await user.type(screen.getByLabelText('Setup code'), 'X')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the password hint', () => {
  it('starts with the rule, counts down, and says when it is enough', () => {
    expect(passwordHint('')).toBe('At least 10 characters. A few random words work well.')
    expect(passwordHint('123456789')).toBe('1 more character to go.')
    expect(passwordHint('1234567')).toBe('3 more characters to go.')
    expect(passwordHint('1234567890')).toBe('Long enough.')
  })
})
