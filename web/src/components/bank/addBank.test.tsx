// Adding a bank without linking one twice: the banks already connected come
// first, a bank Plaid's window says is already here is kept rather than added,
// and a second login at the same bank takes a deliberate yes. Plaid's window
// is mocked (test/plaid.ts); no test reaches Plaid.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../api/client'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../../test/fake'
import { plaid, plaidExits, plaidSucceeds, resetPlaid, windowMetadata } from '../../test/plaid'
import { AddBank } from './AddBank'
import type { DuplicateBankDetails } from './linking'

vi.mock('react-plaid-link', async () => (await import('../../test/plaid')).plaidLinkMock)

afterEach(() => vi.unstubAllGlobals())
beforeEach(resetPlaid)

const CHASE = { id: 'ins_56', name: 'Chase' }
const CHECKING = { name: 'Total Checking', mask: '1234' }

function connection(fields: Partial<Connection> & Pick<Connection, 'id'>): Connection {
  return {
    provider: 'plaid',
    institutionName: 'Chase',
    status: 'active',
    lastSyncedAt: null,
    lastError: null,
    accountCount: 2,
    unsharedCount: 0,
    ...fields,
  }
}

const chase = connection({ id: 'conn-chase' })
const bok = connection({ id: 'conn-bok', institutionName: 'BOK Financial', status: 'needs_reauth' })

const linked = (institutionName = 'Chase', possibleDuplicateOf: string | null = null) => ({
  connectionId: 'conn-new',
  institutionName,
  added: 12,
  modified: 0,
  removed: 0,
  error: null,
  possibleDuplicateOf,
})

/** The server's refusal of a bank already connected, as it sends it. */
function alreadyConnected(details: DuplicateBankDetails) {
  return () =>
    Response.json(
      {
        error: 'duplicate_bank',
        message: `${details.institutionName} is already connected.`,
        details,
      },
      { status: 409 },
    )
}

const chaseHere: DuplicateBankDetails = {
  institutionName: 'Chase',
  logins: [
    { connectionId: 'conn-chase', institutionName: 'Chase', status: 'active', sameAccounts: false },
  ],
}

/** link_bank refuses the first time as already connected, then links (after a confirmed yes). */
function refusedOnce(details: DuplicateBankDetails = chaseHere) {
  let calls = 0
  const refuse = alreadyConnected(details)
  return () => (++calls === 1 ? refuse() : Response.json({ result: linked() }))
}

/** Opens Plaid's window from the panel of banks already connected. */
async function openWindowPastPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Connect another bank' }))
  await user.click(screen.getByRole('button', { name: 'Add a different bank' }))
  await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
}

describe('the first bank', () => {
  it('opens Plaid at once and sends the bank and accounts the window reports', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => linked(),
    })
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[]} onDone={onDone} />)
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    expect(button).toHaveClass('primary')
    await userEvent.setup().click(button)

    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
    expect(plaid.options?.token).toBe('link-token-1')
    expect(server.actions('create_link_token')).toEqual([{}])
    expect(screen.queryByRole('region', { name: 'Already connected' })).not.toBeInTheDocument()
    // The button waits while Plaid's window is open.
    expect(button).toBeDisabled()

    plaidSucceeds('public-abc', windowMetadata(CHASE, [CHECKING]))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('link_bank')).toEqual([
      {
        publicToken: 'public-abc',
        institution: CHASE,
        accounts: [CHECKING],
        allowSecondLogin: false,
      },
    ])
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sends no bank when the window does not name one', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => linked(),
    })
    renderSignedIn(<AddBank connections={[]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    plaidSucceeds('public-abc')
    await waitFor(() =>
      expect(server.actions('link_bank')).toEqual([
        { publicToken: 'public-abc', institution: null, accounts: [], allowSecondLogin: false },
      ]),
    )
  })

  it('says it is pulling in accounts while the bank is saved', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => linked(),
    })
    const release = holdRequest('/api/actions/link_bank')
    renderSignedIn(<AddBank connections={[]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc', windowMetadata(CHASE))
    expect(await screen.findByRole('button', { name: 'Pulling in your accounts' })).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('does nothing more when the window closes, or finishes with no token', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[]} onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
    plaidExits()
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(2))
    plaidSucceeds(null)
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()

    expect(server.actions('create_link_token')).toHaveLength(2)
    expect(server.actions('link_bank')).toEqual([])
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows why the window could not open, and clears that on a new try', async () => {
    let tries = 0
    fakeServer(
      {},
      {
        '/api/actions/create_link_token': () =>
          ++tries === 1
            ? Response.json(
                { error: 'not_configured', message: 'Bank sync is not set up.' },
                { status: 503 },
              )
            : Response.json({ result: { linkToken: 'link-token-2' } }),
      },
    )
    renderSignedIn(<AddBank connections={[]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bank sync is not set up.')
    expect(plaid.open).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why linking failed and does not report it done', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      { '/api/actions/link_bank': failing('The bank did not answer.', 502) },
    )
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[]} onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc', windowMetadata(CHASE))
    expect(await screen.findByRole('alert')).toHaveTextContent('The bank did not answer.')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })
})

describe('before Plaid opens, with banks connected', () => {
  it('shows the banks already connected first, and opens nothing yet', async () => {
    const server = fakeServer({})
    renderSignedIn(<AddBank connections={[chase, bok]} />)
    const start = screen.getByRole('button', { name: 'Connect another bank' })
    expect(start).not.toHaveClass('primary')
    await userEvent.setup().click(start)

    const panel = screen.getByRole('region', { name: 'Already connected' })
    expect(within(panel).getByRole('heading', { name: 'Already connected' })).toHaveFocus()
    const rows = within(panel).getAllByText(/^(Chase|BOK Financial)$/)
    expect(rows.map((row) => row.textContent)).toEqual(['Chase', 'BOK Financial'])
    // A healthy bank reconnects; one whose login broke is fixed.
    expect(rowOf(panel, 'Chase')).toHaveTextContent('Connected')
    expect(within(rowOf(panel, 'Chase')).getByRole('button', { name: 'Reconnect' })).toBeVisible()
    expect(rowOf(panel, 'BOK Financial')).toHaveTextContent('Needs you to sign in again')
    expect(
      within(rowOf(panel, 'BOK Financial')).getByRole('button', { name: 'Fix login' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Connect another bank' })).not.toBeInTheDocument()
    expect(server.calls).toEqual([])
    expect(plaid.open).not.toHaveBeenCalled()
  })

  it('reconnects a bank there in update mode, sharing more accounts, with no new link', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'update-token' }),
      bank_reconnected: () => linked(),
    })
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[chase, bok]} onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect another bank' }))
    const panel = screen.getByRole('region', { name: 'Already connected' })
    await user.click(within(rowOf(panel, 'Chase')).getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([
      { connectionId: 'conn-chase', chooseAccounts: true },
    ])

    plaidSucceeds('public-update', windowMetadata(CHASE))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('bank_reconnected')).toEqual([{ connectionId: 'conn-chase' }])
    expect(server.actions('link_bank')).toEqual([])
    // Done: the panel closes.
    expect(screen.queryByRole('region', { name: 'Already connected' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeEnabled()
  })

  it('fixes a broken login there by signing in again', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'repair-token' }),
      bank_reconnected: () => linked('BOK Financial'),
    })
    renderSignedIn(<AddBank connections={[chase, bok]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect another bank' }))
    const panel = screen.getByRole('region', { name: 'Already connected' })
    await user.click(
      within(rowOf(panel, 'BOK Financial')).getByRole('button', { name: 'Fix login' }),
    )
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([{ connectionId: 'conn-bok' }])
  })

  it('backs out with Cancel, asking the server nothing', async () => {
    const server = fakeServer({})
    renderSignedIn(<AddBank connections={[chase]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect another bank' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Already connected' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeEnabled()
    expect(server.calls).toEqual([])
  })

  it('opens Plaid for a new bank only after Add a different bank', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => linked('BOK Financial'),
    })
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[chase]} onDone={onDone} />)
    await openWindowPastPanel(userEvent.setup())
    expect(server.actions('create_link_token')).toEqual([{}])
    expect(screen.queryByRole('region', { name: 'Already connected' })).not.toBeInTheDocument()

    plaidSucceeds('public-bok', windowMetadata({ id: 'ins_14', name: 'BOK Financial' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('stays on the panel, Add a different bank waiting, while the window is fetched', async () => {
    fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const release = holdRequest('/api/actions/create_link_token')
    renderSignedIn(<AddBank connections={[chase]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect another bank' }))
    await user.click(screen.getByRole('button', { name: 'Add a different bank' }))
    expect(screen.getByRole('button', { name: 'Add a different bank' })).toBeDisabled()
    release()
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
  })

  it('shows other buttons beside its own while nothing is open', async () => {
    fakeServer({})
    renderSignedIn(
      <AddBank connections={[chase]} beside={<button type="button">Sync now</button>} />,
    )
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect another bank' }))
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  })
})

describe('after Plaid, a bank that is already connected', () => {
  it('offers to keep the login Leeway has, and keeping it adds nothing', async () => {
    const server = fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      { '/api/actions/link_bank': alreadyConnected(chaseHere) },
    )
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[chase]} onDone={onDone} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-again', windowMetadata(CHASE, [CHECKING]))

    const panel = await screen.findByRole('region', { name: 'Chase is already connected' })
    expect(within(panel).getByRole('heading')).toHaveFocus()
    expect(panel).toHaveTextContent(
      'Leeway already has a login there. Keeping it adds nothing new.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Keep the one I have' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Kept your Chase login. Nothing new was added.',
    )
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeEnabled()
    expect(server.actions('link_bank')).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('says it looks like the same login when the accounts picked are already here', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      {
        '/api/actions/link_bank': alreadyConnected({
          ...chaseHere,
          logins: [{ ...chaseHere.logins[0]!, sameAccounts: true }],
        }),
      },
    )
    renderSignedIn(<AddBank connections={[chase]} />)
    await openWindowPastPanel(userEvent.setup())
    plaidSucceeds('public-again', windowMetadata(CHASE, [CHECKING]))

    expect(
      await screen.findByText(/The accounts you picked are already in Leeway/),
    ).toHaveTextContent('so this looks like the login you have.')
  })

  it('offers to fix the login Leeway has when that one stopped syncing', async () => {
    const server = fakeServer(
      {
        create_link_token: () => ({ linkToken: 'link-token-1' }),
        bank_reconnected: () => linked(),
      },
      {
        '/api/actions/link_bank': alreadyConnected({
          ...chaseHere,
          logins: [{ ...chaseHere.logins[0]!, status: 'needs_reauth' }],
        }),
      },
    )
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[chase]} onDone={onDone} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-again', windowMetadata(CHASE))

    const panel = await screen.findByRole('region', { name: 'Chase is already connected' })
    expect(within(panel).queryByRole('button', { name: 'Keep the one I have' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Fix the one I have' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(2))
    expect(server.actions('create_link_token')).toEqual([{}, { connectionId: 'conn-chase' }])

    plaidSucceeds('public-repair')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('bank_reconnected')).toEqual([{ connectionId: 'conn-chase' }])
    expect(server.actions('link_bank')).toHaveLength(1)
  })

  it('can leave a broken login as it is, with Not now', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      {
        '/api/actions/link_bank': alreadyConnected({
          ...chaseHere,
          logins: [{ ...chaseHere.logins[0]!, status: 'error' }],
        }),
      },
    )
    renderSignedIn(<AddBank connections={[chase]} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-again', windowMetadata(CHASE))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.getByRole('status')).toHaveTextContent('Kept your Chase login.')
  })

  it('adds a second login at the same bank only after a deliberate yes', async () => {
    const server = fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      { '/api/actions/link_bank': refusedOnce() },
    )
    const onDone = vi.fn()
    renderSignedIn(<AddBank connections={[chase]} onDone={onDone} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-partner', windowMetadata(CHASE, [CHECKING]))

    await user.click(await screen.findByRole('button', { name: "It's a different login" }))
    const confirm = screen.getByRole('region', { name: 'Add a second Chase login?' })
    expect(confirm).toHaveTextContent("like a partner's or a business account")
    expect(confirm).toHaveTextContent('keeps counting even if you remove it later')
    // Nothing more is sent until the owner says yes.
    expect(server.actions('link_bank')).toHaveLength(1)

    await user.click(within(confirm).getByRole('button', { name: 'Add second login' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('link_bank')).toEqual([
      {
        publicToken: 'public-partner',
        institution: CHASE,
        accounts: [CHECKING],
        allowSecondLogin: false,
      },
      {
        publicToken: 'public-partner',
        institution: CHASE,
        accounts: [CHECKING],
        allowSecondLogin: true,
      },
    ])
    expect(screen.queryByRole('region', { name: 'Add a second Chase login?' })).toBeNull()
  })

  it('goes back from the second-login question to keeping the one it has', async () => {
    const server = fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      { '/api/actions/link_bank': alreadyConnected(chaseHere) },
    )
    renderSignedIn(<AddBank connections={[chase]} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-again', windowMetadata(CHASE))
    await user.click(await screen.findByRole('button', { name: "It's a different login" }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('region', { name: 'Chase is already connected' })).toBeVisible()
    expect(server.actions('link_bank')).toHaveLength(1)
  })

  it('waits while the second login is saved, and stays on the question if it fails', async () => {
    let calls = 0
    const refuse = alreadyConnected(chaseHere)
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      {
        '/api/actions/link_bank': () =>
          ++calls === 1 ? refuse() : failing('That link expired.', 502)(),
      },
    )
    renderSignedIn(<AddBank connections={[chase]} />)
    const user = userEvent.setup()
    await openWindowPastPanel(user)
    plaidSucceeds('public-partner', windowMetadata(CHASE))
    await user.click(await screen.findByRole('button', { name: "It's a different login" }))
    const release = holdRequest('/api/actions/link_bank')
    await user.click(screen.getByRole('button', { name: 'Add second login' }))
    expect(screen.getByRole('button', { name: 'Pulling in your accounts' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    release()

    expect(await screen.findByRole('alert')).toHaveTextContent('That link expired.')
    expect(screen.getByRole('region', { name: 'Add a second Chase login?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add second login' })).toBeEnabled()
  })

  it('reads a refusal that names no login to keep as a plain error', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      {
        '/api/actions/link_bank': () =>
          Response.json(
            { error: 'duplicate_bank', message: 'Chase is already connected.' },
            { status: 409 },
          ),
      },
    )
    renderSignedIn(<AddBank connections={[chase]} />)
    await openWindowPastPanel(userEvent.setup())
    plaidSucceeds('public-again', windowMetadata(CHASE))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chase is already connected.')
    expect(screen.queryByRole('region', { name: 'Chase is already connected' })).toBeNull()
  })
})

describe('a duplicate that shows only once Plaid has counted it', () => {
  it('says the new login was added, and that one can be removed if they are the same', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => linked('Chase', 'conn-chase'),
    })
    renderSignedIn(<AddBank connections={[chase]} />)
    await openWindowPastPanel(userEvent.setup())
    plaidSucceeds('public-unnamed')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added. You now have two Chase logins. If they are the same login, you can remove one.',
    )
  })

  it('names no bank when Plaid did not name one either', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => ({ ...linked('Chase', 'conn-chase'), institutionName: null }),
    })
    renderSignedIn(<AddBank connections={[chase]} />)
    await openWindowPastPanel(userEvent.setup())
    plaidSucceeds('public-unnamed')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added. You now have two logins at the same bank.',
    )
  })
})

/** The row of one bank in a panel. */
function rowOf(panel: HTMLElement, name: string): HTMLElement {
  return within(panel).getByText(name).closest('.list-row') as HTMLElement
}
